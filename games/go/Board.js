/**
 * 围棋规则（中国规则 · 数子法）
 *
 * 格子 i = y * size + x；x 为列（A 起，跳过 I），y 从上到下，显示行号 = size - y
 * 棋子：0 空、1 黑、2 白；黑先
 *
 * - 提子：落子后对方无气的块被提走
 * - 禁着点：落子后自己无气且不能提子 → 不能下
 * - 禁止全局同形：落子后的局面不能与之前出现过的任何局面相同（包含打劫）
 * - 停一手：双方连续停一手进入数子
 * - 让子：白方在自己第一手之前可以连续让子（跳过落子），最多 5 次；
 *   让子局按中国规则，黑方贴还让子数的一半（子），不再贴 3¾ 子
 * - 计分：活子 + 只被一方围住的空点；黑方贴 komi 目（7.5 目 = 3¾ 子）
 */

export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2
export const PASS = -1
export const YIELD = -2 // 让子
export const SIZES = [9, 13, 19]
const COLS = "ABCDEFGHJKLMNOPQRST"

export const colName = x => COLS[x]

export function pointName(i, size) {
  return `${COLS[i % size]}${size - Math.floor(i / size)}`
}

/** 解析 D4 / d4 / 4D，失败返回 -1（列字母没有 I） */
export function parsePoint(text, size) {
  const t = String(text).trim().replace(/\s+/g, "")
  let m = /^([a-z])(\d{1,2})$/i.exec(t)
  let col, row
  if (m) [col, row] = [m[1], m[2]]
  else if ((m = /^(\d{1,2})([a-z])$/i.exec(t))) [row, col] = [m[1], m[2]]
  else return -1
  const x = COLS.indexOf(col.toUpperCase())
  const r = Number(row)
  if (x < 0 || x >= size || r < 1 || r > size) return -1
  return (size - r) * size + x
}

/** 星位 */
export function starPoints(size) {
  const lines = size === 9 ? [2, 4, 6] : size === 13 ? [3, 6, 9] : [3, 9, 15]
  const list = []
  for (const y of lines) for (const x of lines) {
    // 9 路、13 路只用四角和天元
    if (size !== 19 && (x === lines[1]) !== (y === lines[1])) continue
    list.push(y * size + x)
  }
  return list
}

const neighborCache = new Map()
export function neighbors(size) {
  if (neighborCache.has(size)) return neighborCache.get(size)
  const list = []
  for (let i = 0; i < size * size; i++) {
    const x = i % size
    const y = Math.floor(i / size)
    const n = []
    if (x > 0) n.push(i - 1)
    if (x < size - 1) n.push(i + 1)
    if (y > 0) n.push(i - size)
    if (y < size - 1) n.push(i + size)
    list.push(n)
  }
  neighborCache.set(size, list)
  return list
}

/** 找出 i 所在的块和它的气 */
export function groupAt(cells, size, i) {
  const nb = neighbors(size)
  const color = cells[i]
  const stones = [i]
  const seen = new Set([i])
  const libs = new Set()
  for (let k = 0; k < stones.length; k++) {
    for (const j of nb[stones[k]]) {
      if (cells[j] === EMPTY) libs.add(j)
      else if (cells[j] === color && !seen.has(j)) {
        seen.add(j)
        stones.push(j)
      }
    }
  }
  return { stones, libs }
}

const boardKey = cells => cells.join("")

/**
 * 在 cells 上试着落子（会修改 cells）
 * @returns {{ captured: number[] } | { error: string }}
 */
export function placeStone(cells, size, i, color) {
  if (cells[i] !== EMPTY) return { error: "occupied" }
  const nb = neighbors(size)
  const opp = 3 - color
  cells[i] = color
  const captured = []
  for (const j of nb[i]) {
    if (cells[j] !== opp) continue
    const g = groupAt(cells, size, j)
    if (!g.libs.size) for (const s of g.stones) {
      cells[s] = EMPTY
      captured.push(s)
    }
  }
  if (!captured.length && !groupAt(cells, size, i).libs.size) {
    cells[i] = EMPTY
    return { error: "suicide" }
  }
  return { captured }
}

export const RESULT_REASON = {
  score: "数子",
  resign: "认输",
  timeout: "超时",
  agreed: "双方同意和棋",
}

export class GoGame {
  /**
   * @param {object} opt { size, moves, komi, maxYield }
   *   moves：落子位置，PASS 为停一手，YIELD 为让子
   */
  constructor({ size = 9, moves = [], komi = 7.5, maxYield = 5 } = {}) {
    if (!SIZES.includes(size)) throw new Error(`不支持 ${size} 路棋盘`)
    this.size = size
    this.baseKomi = komi
    this.maxYield = maxYield
    this.result = null
    this.reset()
    for (const m of moves) {
      const r = m === PASS ? this.pass() : m === YIELD ? this.yieldTurn() : this.play(m)
      if (r.error) throw new Error(`棋谱错误：${r.error}`)
    }
  }

  reset() {
    this.cells = new Uint8Array(this.size * this.size)
    this.moves = []
    this.captures = { [BLACK]: 0, [WHITE]: 0 } // 各方提掉的对方子数
    this.history = new Set([boardKey(this.cells)])
    this.lastCaptured = []
  }

  get side() {
    return this.moves.length % 2 === 0 ? BLACK : WHITE
  }

  get moveCount() {
    return this.moves.length
  }

  /** 实际落子手数（不含停一手、让子） */
  get stoneMoves() {
    return this.moves.filter(m => m >= 0).length
  }

  get lastMove() {
    for (let k = this.moves.length - 1; k >= 0; k--) if (this.moves[k] !== YIELD) return this.moves[k]
    return null
  }

  /** 让子次数（白方开局连续让子） */
  get yields() {
    return this.moves.filter(m => m === YIELD).length
  }

  /** 让子数：白方第一手之前黑方下的子数（≥2 才算让子棋） */
  get handicap() {
    return this.yields ? this.yields + 1 : 0
  }

  /** 贴目：让子局按中国规则，黑方贴还让子数的一半（子）= 让子数（目） */
  get komi() {
    return this.handicap >= 2 ? this.handicap : this.baseKomi
  }

  /** 白方现在能否让子 */
  canYield() {
    if (this.result || this.side !== WHITE || this.yields >= this.maxYield) return false
    // 白方还没下过子，之前白方的每一手都是让子
    for (let k = 1; k < this.moves.length; k += 2) if (this.moves[k] !== YIELD) return false
    return true
  }

  /** 最近是否双方连续停一手（让子不算） */
  get bothPassed() {
    const n = this.moves.length
    return n >= 2 && this.moves[n - 1] === PASS && this.moves[n - 2] === PASS
  }

  play(i) {
    if (this.result) return { error: "对局已结束" }
    if (i < 0 || i >= this.cells.length) return { error: "不在棋盘上" }
    const name = pointName(i, this.size)
    if (this.cells[i] !== EMPTY) return { error: `${name} 已经有子了` }
    const color = this.side
    const next = Uint8Array.from(this.cells)
    const r = placeStone(next, this.size, i, color)
    if (r.error === "suicide") return { error: `${name} 是禁着点：下了之后自己没有气，也提不掉对方的子` }
    const key = boardKey(next)
    if (this.history.has(key)) return { error: `${name} 不能下：会和之前的局面相同（打劫要先在别处下一手）` }
    this.cells = next
    this.history.add(key)
    this.moves.push(i)
    this.captures[color] += r.captured.length
    this.lastCaptured = r.captured
    return { ok: true, captured: r.captured }
  }

  pass() {
    if (this.result) return { error: "对局已结束" }
    this.moves.push(PASS)
    this.lastCaptured = []
    return { ok: true, bothPassed: this.bothPassed }
  }

  yieldTurn() {
    if (!this.canYield()) {
      if (this.side !== WHITE) return { error: "只有白方可以让子" }
      if (this.yields >= this.maxYield) return { error: `最多让 ${this.maxYield} 子` }
      return { error: "白方已经落过子，不能再让子了" }
    }
    this.moves.push(YIELD)
    this.lastCaptured = []
    return { ok: true }
  }

  /** 撤回最近 n 手（停一手、让子各算一手），通过重放实现 */
  undo(n = 1) {
    const keep = this.moves.slice(0, Math.max(0, this.moves.length - n))
    this.result = null
    this.reset()
    for (const m of keep) {
      if (m === PASS) this.pass()
      else if (m === YIELD) this.yieldTurn()
      else this.play(m)
    }
    return n
  }

  end(winner, reason, extra = {}) {
    this.result = { winner, reason, ...extra }
    return this.result
  }

  /**
   * 数子（数子法）
   * @param {Iterable<number>} dead 认定为死子的位置
   * @returns {{ black, white, komi, diff, winner, owner: Int8Array }}
   *   black/white：各方子数（活子 + 地）；diff = 黑 - 白 - 贴目；owner：每点归属 0/1/2
   */
  score(dead = []) {
    const size = this.size
    const nb = neighbors(size)
    const cells = Uint8Array.from(this.cells)
    for (const i of dead) cells[i] = EMPTY
    const owner = new Int8Array(cells.length)
    const seen = new Uint8Array(cells.length)
    let black = 0
    let white = 0
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === BLACK) {
        black++
        owner[i] = BLACK
      } else if (cells[i] === WHITE) {
        white++
        owner[i] = WHITE
      }
    }
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== EMPTY || seen[i]) continue
      // 一片空点，看边界有哪些颜色
      const region = [i]
      seen[i] = 1
      const border = new Set()
      for (let k = 0; k < region.length; k++) {
        for (const j of nb[region[k]]) {
          if (cells[j] === EMPTY) {
            if (!seen[j]) {
              seen[j] = 1
              region.push(j)
            }
          } else border.add(cells[j])
        }
      }
      if (border.size === 1) {
        const c = [...border][0]
        for (const j of region) owner[j] = c
        if (c === BLACK) black += region.length
        else white += region.length
      }
    }
    const komi = this.komi
    const diff = black - white - komi
    return { black, white, komi, diff, winner: diff > 0 ? BLACK : diff < 0 ? WHITE : 0, owner }
  }

  toJSON() {
    return { size: this.size, moves: [...this.moves], komi: this.baseKomi, maxYield: this.maxYield, result: this.result }
  }

  static fromJSON(data) {
    const g = new GoGame({ size: data.size, moves: data.moves, komi: data.komi, maxYield: data.maxYield })
    if (data.result) g.result = data.result
    return g
  }
}

/** 目数转成“子”的写法：7.5 目 → 3又3/4 子 */
export function formatZi(points) {
  const zi = Math.abs(points) / 2
  const whole = Math.floor(zi + 1e-9)
  const frac = Math.round((zi - whole) * 4)
  const fracText = ["", "1/4", "1/2", "3/4"][frac]
  if (!whole) return `${fracText || "0"} 子`
  return `${whole}${fracText ? `又${fracText}` : ""} 子`
}
