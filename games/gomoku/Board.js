/**
 * 五子棋规则
 *
 * 棋盘 15×15，格子 i = y * 15 + x
 *   x = 0..14 对应列 A..O（左到右）
 *   y = 0..14 为从上到下，显示的行号 = 15 - y（下面是第 1 行），天元为 H8
 * 棋子：0 空、1 黑、2 白；黑先
 *
 * 禁手（只限制黑棋）：三三、四四；五连优先（同时成五时不算禁手）
 * 长连（六子及以上）：默认算赢，可配置为黑棋禁手
 */

export const SIZE = 15
export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2
export const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]]

const COLS = "ABCDEFGHIJKLMNO"
export const xyOf = i => [i % SIZE, Math.floor(i / SIZE)]
export const idxOf = (x, y) => y * SIZE + x
const inside = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE

/** 坐标名：H8 */
export const pointName = i => {
  const [x, y] = xyOf(i)
  return `${COLS[x]}${SIZE - y}`
}

/** 解析 H8 / h8 / 8H，失败返回 -1 */
export function parsePoint(text) {
  const t = String(text).trim().replace(/\s+/g, "")
  let m = /^([a-o])(\d{1,2})$/i.exec(t)
  let col, row
  if (m) [col, row] = [m[1], m[2]]
  else if ((m = /^(\d{1,2})([a-o])$/i.exec(t))) [row, col] = [m[1], m[2]]
  else return -1
  const x = COLS.indexOf(col.toUpperCase())
  const r = Number(row)
  if (x < 0 || r < 1 || r > SIZE) return -1
  return idxOf(x, SIZE - r)
}

/* ---------------- 棋型判断 ---------------- */

/** 从 (x,y) 沿方向连续同色子数（含自己） */
function run(cells, x, y, dx, dy, color) {
  let n = 1
  for (let k = 1; inside(x + dx * k, y + dy * k) && cells[idxOf(x + dx * k, y + dy * k)] === color; k++) n++
  for (let k = 1; inside(x - dx * k, y - dy * k) && cells[idxOf(x - dx * k, y - dy * k)] === color; k++) n++
  return n
}

/** 连子是否算“五”：exact 为 true 时只有正好五个才算 */
const isFiveLen = (n, exact) => (exact ? n === 5 : n >= 5)

/** i 处的子是否连成五 */
export function makesFive(cells, i, color, exact = false) {
  const [x, y] = xyOf(i)
  return DIRS.some(([dx, dy]) => isFiveLen(run(cells, x, y, dx, dy, color), exact))
}

export function isOverline(cells, i, color) {
  const [x, y] = xyOf(i)
  return DIRS.some(([dx, dy]) => run(cells, x, y, dx, dy, color) >= 6)
}

/**
 * 在方向 d 上，再下一子就能和 i 一起成五的空点
 * （i 处已有 color 子）
 */
function fiveCompletions(cells, i, d, color, exact) {
  const [x, y] = xyOf(i)
  const [dx, dy] = d
  const list = []
  for (let k = -4; k <= 4; k++) {
    if (!k) continue
    const qx = x + dx * k
    const qy = y + dy * k
    if (!inside(qx, qy)) continue
    const q = idxOf(qx, qy)
    if (cells[q] !== EMPTY) continue
    cells[q] = color
    // 成五的连子必须包含 i：从 q 起算连子，且 i 在 q 与连子端点之间
    const n = run(cells, qx, qy, dx, dy, color)
    let ok = isFiveLen(n, exact)
    if (ok) {
      // 检查 i 与 q 之间全是 color（即 i 在这条连子里）
      const step = Math.sign(k)
      for (let s = step; s !== k; s += step) if (cells[idxOf(x + dx * s, y + dy * s)] !== color) ok = false
    }
    cells[q] = EMPTY
    if (ok) list.push(k)
  }
  return list
}

/** 方向 d 上 i 参与的“四”的个数：活四（两个成五点相距 5）算 1 个，否则每个成五点算 1 个 */
function fourCount(cells, i, d, color, exact) {
  const ks = fiveCompletions(cells, i, d, color, exact)
  if (ks.length === 2 && Math.abs(ks[0] - ks[1]) === 5) return 1
  return Math.min(ks.length, 2)
}

/** 方向 d 上 i 是否组成活四（两端都能成五） */
function isStraightFour(cells, i, d, color, exact) {
  const ks = fiveCompletions(cells, i, d, color, exact)
  return ks.length === 2 && Math.abs(ks[0] - ks[1]) === 5
}

/**
 * 方向 d 上 i 是否组成活三：再下一子能形成活四，且那一子本身不是禁手
 */
function isLiveThree(cells, i, d, rules, depth) {
  const [x, y] = xyOf(i)
  const [dx, dy] = d
  const exact = rules.overline === "forbidden"
  for (let k = -4; k <= 4; k++) {
    if (!k) continue
    const qx = x + dx * k
    const qy = y + dy * k
    if (!inside(qx, qy)) continue
    const q = idxOf(qx, qy)
    if (cells[q] !== EMPTY) continue
    cells[q] = BLACK
    const ok = isStraightFour(cells, i, d, BLACK, exact) && !forbiddenAt(cells, q, rules, depth + 1)
    cells[q] = EMPTY
    if (ok) return true
  }
  return false
}

/**
 * 黑子已下在 i 处时，是否构成禁手
 * @returns {"" | "三三" | "四四" | "长连"}
 */
export function forbiddenAt(cells, i, rules = {}, depth = 0) {
  if (rules.forbidden === false) return ""
  const exact = rules.overline === "forbidden"
  if (makesFive(cells, i, BLACK, exact)) return ""
  if (exact && isOverline(cells, i, BLACK)) return "长连"
  // 递归太深时按不是禁手处理（实战中极少出现）
  if (depth > 3) return ""
  let fours = 0
  let threes = 0
  for (const d of DIRS) {
    const f = fourCount(cells, i, d, BLACK, exact)
    if (f) {
      fours += f
      continue
    }
    if (isLiveThree(cells, i, d, rules, depth)) threes++
  }
  if (fours >= 2) return "四四"
  if (threes >= 2) return "三三"
  return ""
}

/** 黑棋在空点 i 落子是否禁手（不改变棋盘） */
export function isForbiddenMove(cells, i, rules = {}) {
  if (cells[i] !== EMPTY) return ""
  cells[i] = BLACK
  const res = forbiddenAt(cells, i, rules)
  cells[i] = EMPTY
  return res
}

/* ---------------- 一局 ---------------- */

export const RESULT_REASON = {
  five: "五连",
  resign: "认输",
  timeout: "超时",
  draw: "棋盘下满",
  agreed: "双方同意和棋",
  forbidden: "禁手",
}

export class GomokuGame {
  /**
   * @param {object} opt { moves?: number[], rules?: { forbidden, overline, forbiddenLoses } }
   */
  constructor({ moves = [], rules = {} } = {}) {
    this.rules = { forbidden: true, overline: "win", forbiddenLoses: false, ...rules }
    this.cells = new Uint8Array(SIZE * SIZE)
    this.moves = []
    this.result = null
    for (const m of moves) {
      const r = this.play(m)
      if (r.error) throw new Error(`棋谱中有非法落子：${pointName(m)}（${r.error}）`)
    }
  }

  get side() {
    return this.moves.length % 2 === 0 ? BLACK : WHITE
  }

  get moveCount() {
    return this.moves.length
  }

  get lastMove() {
    return this.moves.length ? this.moves[this.moves.length - 1] : -1
  }

  /** 当前黑方不能下的点（白方回合返回空列表） */
  forbiddenPoints() {
    if (this.side !== BLACK || !this.rules.forbidden || this.result) return []
    const list = []
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] !== EMPTY) continue
      // 只检查附近有子的点，远处不可能成禁手
      const [x, y] = xyOf(i)
      let near = false
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (inside(x + dx, y + dy) && this.cells[idxOf(x + dx, y + dy)] === BLACK) {
            near = true
            break
          }
        }
      }
      if (near && isForbiddenMove(this.cells, i, this.rules)) list.push(i)
    }
    return list
  }

  /**
   * 落子
   * @returns {{ ok: true, forbidden?: string } | { error: string }}
   */
  play(i) {
    if (this.result) return { error: "对局已结束" }
    if (i < 0 || i >= this.cells.length) return { error: "不在棋盘上" }
    if (this.cells[i] !== EMPTY) return { error: `${pointName(i)} 已经有子了` }
    const color = this.side
    if (color === BLACK) {
      const f = isForbiddenMove(this.cells, i, this.rules)
      if (f) {
        if (!this.rules.forbiddenLoses) return { error: `${pointName(i)} 是黑方禁手（${f}），请换一个位置`, forbidden: f }
        this.cells[i] = color
        this.moves.push(i)
        this.result = { winner: WHITE, reason: "forbidden", detail: f }
        return { ok: true, forbidden: f }
      }
    }
    this.cells[i] = color
    this.moves.push(i)
    const exact = color === BLACK && this.rules.overline === "forbidden"
    if (makesFive(this.cells, i, color, exact)) this.result = { winner: color, reason: "five" }
    else if (this.moves.length === this.cells.length) this.result = { winner: 0, reason: "draw" }
    return { ok: true }
  }

  undo(n = 1) {
    n = Math.min(n, this.moves.length)
    for (let k = 0; k < n; k++) this.cells[this.moves.pop()] = EMPTY
    this.result = null
    return n
  }

  end(winner, reason) {
    this.result = { winner, reason }
    return this.result
  }

  /** 五连的五个点（用于高亮） */
  winningLine() {
    if (this.result?.reason !== "five") return []
    const i = this.lastMove
    const color = this.cells[i]
    const [x, y] = xyOf(i)
    for (const [dx, dy] of DIRS) {
      const line = [i]
      for (let k = 1; inside(x + dx * k, y + dy * k) && this.cells[idxOf(x + dx * k, y + dy * k)] === color; k++) line.push(idxOf(x + dx * k, y + dy * k))
      for (let k = 1; inside(x - dx * k, y - dy * k) && this.cells[idxOf(x - dx * k, y - dy * k)] === color; k++) line.push(idxOf(x - dx * k, y - dy * k))
      if (line.length >= 5) return line
    }
    return []
  }

  toJSON() {
    return { moves: [...this.moves], rules: this.rules, result: this.result }
  }

  static fromJSON(data) {
    const g = new GomokuGame({ moves: data.moves, rules: data.rules })
    if (data.result) g.result = data.result
    return g
  }
}
