/**
 * 扫雷棋盘
 *
 * 格子编号 i = r * cols + c，r 为行（A 起），c 为列（1 起显示，内部从 0）
 * 状态：ready（还没翻开第一格，雷未放置）→ playing → won / lost
 */

export const LEVELS = {
  初级: { rows: 9, cols: 9, mines: 10 },
  中级: { rows: 16, cols: 16, mines: 40 },
  高级: { rows: 16, cols: 30, mines: 99 },
}
export const LEVEL_NAMES = Object.keys(LEVELS)

/** 可复现的随机数（mulberry32） */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const neighborCache = new Map()
/** 每格的相邻格列表 */
export function neighbors(rows, cols) {
  const key = `${rows}x${cols}`
  if (neighborCache.has(key)) return neighborCache.get(key)
  const list = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = []
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const rr = r + dr
          const cc = c + dc
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) n.push(rr * cols + cc)
        }
      }
      list.push(n)
    }
  }
  neighborCache.set(key, list)
  return list
}

/**
 * 随机放雷：first 及其相邻格不放雷（格子不够时只保证 first 本身）
 * @returns {number[]} 雷的位置
 */
export function layMines(rows, cols, mines, first, random = Math.random) {
  const total = rows * cols
  const nb = neighbors(rows, cols)
  let banned = new Set([first, ...nb[first]])
  if (total - banned.size < mines) banned = new Set([first])
  const pool = []
  for (let i = 0; i < total; i++) if (!banned.has(i)) pool.push(i)
  // 洗牌取前 mines 个
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, mines).sort((a, b) => a - b)
}

export class Minefield {
  /**
   * @param {object} opt { rows, cols, mines, mineList?, open?, flags?, status? }
   */
  constructor({ rows, cols, mines, mineList = null, open = [], flags = [], status, exploded = -1 }) {
    this.rows = rows
    this.cols = cols
    this.mines = mines
    this.total = rows * cols
    this.nb = neighbors(rows, cols)
    this.mine = new Uint8Array(this.total)
    this.count = new Uint8Array(this.total)
    this.open = new Uint8Array(this.total)
    this.flag = new Uint8Array(this.total)
    this.openCount = 0
    this.exploded = exploded
    if (mineList) this.setMines(mineList)
    for (const i of open) {
      if (!this.open[i]) this.openCount++
      this.open[i] = 1
    }
    for (const i of flags) this.flag[i] = 1
    this.status = status || (mineList ? "playing" : "ready")
  }

  setMines(list) {
    this.mine.fill(0)
    this.count.fill(0)
    for (const i of list) this.mine[i] = 1
    for (let i = 0; i < this.total; i++) {
      let n = 0
      for (const j of this.nb[i]) n += this.mine[j]
      this.count[i] = n
    }
    this.mineList = [...list]
  }

  get flagCount() {
    let n = 0
    for (let i = 0; i < this.total; i++) n += this.flag[i]
    return n
  }

  /** 剩余雷数（总数减旗数，可能为负） */
  get minesLeft() {
    return this.mines - this.flagCount
  }

  get ended() {
    return this.status === "won" || this.status === "lost"
  }

  /** 翻开一格（不处理快速翻开），0 时连锁展开；返回新翻开的格子 */
  floodOpen(start) {
    const opened = []
    if (this.open[start] || this.flag[start]) return opened
    const stack = [start]
    while (stack.length) {
      const i = stack.pop()
      if (this.open[i] || this.flag[i]) continue
      this.open[i] = 1
      this.openCount++
      opened.push(i)
      if (this.mine[i]) continue
      if (this.count[i] === 0) for (const j of this.nb[i]) if (!this.open[j] && !this.flag[j]) stack.push(j)
    }
    return opened
  }

  /**
   * 玩家翻开一格
   * - 未翻开：翻开（0 连锁展开）
   * - 已翻开的数字且周围旗数相等：快速翻开周围
   * @returns {{ opened: number[], exploded?: number, note?: string }}
   */
  reveal(i) {
    if (this.ended) return { opened: [], note: "ended" }
    if (this.status === "ready") throw new Error("请先放雷")
    if (this.flag[i]) return { opened: [], note: "flagged" }
    if (this.open[i]) return this.chord(i)
    const opened = this.floodOpen(i)
    if (this.mine[i]) return this.lose(i, opened)
    this.checkWin()
    return { opened }
  }

  /** 快速翻开：数字周围旗数等于数字时，翻开周围其他格子 */
  chord(i) {
    if (!this.open[i] || this.mine[i] || this.count[i] === 0) return { opened: [], note: "nothing" }
    let flags = 0
    const hidden = []
    for (const j of this.nb[i]) {
      if (this.flag[j]) flags++
      else if (!this.open[j]) hidden.push(j)
    }
    if (flags !== this.count[i] || !hidden.length) return { opened: [], note: hidden.length ? "flags" : "nothing" }
    const opened = []
    let boom = -1
    for (const j of hidden) {
      opened.push(...this.floodOpen(j))
      if (this.mine[j] && boom < 0) boom = j
    }
    if (boom >= 0) return this.lose(boom, opened)
    this.checkWin()
    return { opened }
  }

  /** 自动翻开：反复对“旗数等于数字”的格子做快速翻开 */
  autoChord() {
    const opened = []
    let changed = true
    while (changed && !this.ended) {
      changed = false
      for (let i = 0; i < this.total && !this.ended; i++) {
        if (!this.open[i] || this.mine[i] || !this.count[i]) continue
        const res = this.chord(i)
        if (res.opened.length) {
          opened.push(...res.opened)
          changed = true
        }
        if (res.exploded !== undefined) return { opened, exploded: res.exploded }
      }
    }
    return { opened }
  }

  toggleFlag(i) {
    if (this.ended || this.open[i]) return false
    this.flag[i] = this.flag[i] ? 0 : 1
    return true
  }

  lose(i, opened) {
    this.status = "lost"
    this.exploded = i
    return { opened, exploded: i }
  }

  checkWin() {
    if (this.openCount === this.total - this.mines && this.status === "playing") {
      this.status = "won"
      // 赢了自动把雷都插上旗
      for (let i = 0; i < this.total; i++) this.flag[i] = this.mine[i]
    }
    return this.status === "won"
  }

  /** 认输 / 超时：标记为失败 */
  giveUp() {
    if (!this.ended) this.status = "lost"
  }

  toJSON() {
    const open = []
    const flags = []
    for (let i = 0; i < this.total; i++) {
      if (this.open[i]) open.push(i)
      if (this.flag[i]) flags.push(i)
    }
    return { rows: this.rows, cols: this.cols, mines: this.mines, mineList: this.mineList || null, open, flags, status: this.status, exploded: this.exploded }
  }

  static fromJSON(data) {
    return new Minefield(data)
  }
}
