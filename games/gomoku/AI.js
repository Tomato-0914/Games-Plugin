/**
 * 五子棋 AI：五元组评估 + Alpha-Beta 搜索
 *
 * 五元组：棋盘上所有连续 5 格的窗口（横、竖、两条斜线共 572 个）。
 * 每个窗口里只有一方的子时，按子数计分；双方都有子的窗口没有价值。
 * 落子时只更新经过这一点的窗口（最多 20 个），评估是增量的。
 *
 * AI 执黑时，根节点的候选点会排除禁手。
 */
import { SIZE, BLACK, WHITE, EMPTY, xyOf, idxOf, makesFive, isForbiddenMove } from "./Board.js"

const N = SIZE * SIZE
const WIN = 1e7

/* ---------- 五元组 ---------- */
const WINDOWS = []
const CELL_WINDOWS = Array.from({ length: N }, () => [])
for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const ex = x + dx * 4
      const ey = y + dy * 4
      if (ex < 0 || ex >= SIZE || ey < 0 || ey >= SIZE) continue
      const w = []
      for (let k = 0; k < 5; k++) w.push(idxOf(x + dx * k, y + dy * k))
      const id = WINDOWS.length
      WINDOWS.push(w)
      for (const i of w) CELL_WINDOWS[i].push(id)
    }
  }
}

/** 局面评估：窗口里只有一方 k 个子时的分值 */
const EVAL = [0, 1, 12, 150, 2500, 0]
/** 选点：进攻（己方 k 个子的窗口）与防守（对方 k 个子的窗口） */
const ATTACK = [7, 35, 800, 15000, 800000]
const DEFEND = [7, 15, 400, 1800, 100000]

export const LEVELS = {
  简单: { depth: 1, width: 8, noise: 0.35 },
  普通: { depth: 5, width: 10, noise: 0, time: 2000 },
  困难: { depth: 7, width: 10, noise: 0, time: 5000 },
}
export const LEVEL_NAMES = Object.keys(LEVELS)

class Search {
  constructor(moves, rules) {
    this.rules = rules
    this.cells = new Uint8Array(N)
    this.count = [null, new Uint8Array(WINDOWS.length), new Uint8Array(WINDOWS.length)]
    this.near = new Uint8Array(N)
    this.score = 0 // 黑方视角
    this.stones = 0
    for (const m of moves) this.place(m, this.stones % 2 === 0 ? BLACK : WHITE)
  }

  windowValue(w) {
    const b = this.count[BLACK][w]
    const wh = this.count[WHITE][w]
    if (b && wh) return 0
    return b ? EVAL[b] : -EVAL[wh]
  }

  /** 落子，返回是否成五 */
  place(i, color) {
    let five = false
    for (const w of CELL_WINDOWS[i]) {
      this.score -= this.windowValue(w)
      if (++this.count[color][w] === 5) five = true
      this.score += this.windowValue(w)
    }
    this.cells[i] = color
    this.stones++
    this.touchNear(i, 1)
    if (five) {
      const exact = color === BLACK && this.rules.overline === "forbidden"
      five = makesFive(this.cells, i, color, exact)
    }
    return five
  }

  remove(i, color) {
    for (const w of CELL_WINDOWS[i]) {
      this.score -= this.windowValue(w)
      this.count[color][w]--
      this.score += this.windowValue(w)
    }
    this.cells[i] = EMPTY
    this.stones--
    this.touchNear(i, -1)
  }

  touchNear(i, d) {
    const [x, y] = xyOf(i)
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE) this.near[idxOf(nx, ny)] += d
      }
    }
  }

  /** 某点对 color 的价值（进攻 + 防守） */
  pointScore(i, color) {
    const opp = 3 - color
    let s = 0
    for (const w of CELL_WINDOWS[i]) {
      const own = this.count[color][w]
      const oth = this.count[opp][w]
      if (!oth) s += ATTACK[own]
      if (!own) s += DEFEND[oth]
    }
    return s
  }

  candidates(color, width, root = false) {
    if (!this.stones) return { moves: [idxOf(7, 7)], scored: [[idxOf(7, 7), 0]] }
    const list = []
    for (let i = 0; i < N; i++) {
      if (this.cells[i] || !this.near[i]) continue
      list.push([i, this.pointScore(i, color)])
    }
    list.sort((a, b) => b[1] - a[1])
    let moves = list.map(([i]) => i)
    if (root && color === BLACK && this.rules.forbidden !== false) {
      moves = moves.filter(i => !isForbiddenMove(this.cells, i, this.rules))
    }
    return { moves: moves.slice(0, width), scored: list }
  }

  timeUp() {
    if ((++this.nodes & 255) === 0 && this.deadline && Date.now() > this.deadline) this.stopped = true
    return this.stopped
  }

  negamax(color, depth, alpha, beta, ply, width) {
    if (this.timeUp()) return 0
    if (depth === 0) return color === BLACK ? this.score : -this.score
    const { moves } = this.candidates(color, width)
    if (!moves.length) return 0
    let best = -Infinity
    for (const m of moves) {
      const five = this.place(m, color)
      const v = five ? WIN - ply : -this.negamax(3 - color, depth - 1, -beta, -alpha, ply + 1, width)
      this.remove(m, color)
      if (this.stopped) return 0
      if (v > best) best = v
      if (v > alpha) alpha = v
      if (alpha >= beta) break
    }
    return best
  }

  /** 根节点：返回最佳点 */
  root(color, { depth, width, noise = 0, time = 0 }) {
    this.nodes = 0
    this.stopped = false
    this.deadline = time ? Date.now() + time : 0
    const { moves, scored } = this.candidates(color, Math.max(width, 12), true)
    if (!moves.length) return -1
    if (moves.length === 1) return moves[0]
    // 能直接成五就下
    for (const m of moves) {
      const five = this.place(m, color)
      this.remove(m, color)
      if (five) return m
    }
    if (noise) {
      // 简单难度：按选点分带噪声挑一个
      const top = scored.filter(([i]) => moves.includes(i)).slice(0, 6)
      const pick = top.map(([i, s]) => [i, s * (1 + (Math.random() * 2 - 1) * noise)]).sort((a, b) => b[1] - a[1])[0]
      // 对方马上成五时必须堵
      return this.mustBlock(color, moves) ?? pick[0]
    }
    // 开局前几手在较好的几个点里随机，避免每盘都一样
    if (this.stones < 4) {
      const top = scored.filter(([i]) => moves.includes(i)).slice(0, 3)
      return top[Math.floor(Math.random() * top.length)][0]
    }
    let best = moves[0]
    // 迭代加深（奇数层，保证最后一层是对方应着之后的评估更稳定）
    for (let d = 1; d <= depth; d += 2) {
      let bestHere = moves[0]
      let alpha = -Infinity
      for (const m of moves) {
        const five = this.place(m, color)
        const v = five ? WIN : -this.negamax(3 - color, d - 1, -Infinity, -alpha, 1, width)
        this.remove(m, color)
        if (this.stopped) break
        if (v > alpha) {
          alpha = v
          bestHere = m
        }
      }
      if (this.stopped) break
      best = bestHere
      if (alpha >= WIN - 100) break
    }
    return best
  }

  /** 对方下一步就能成五的点（必须堵） */
  mustBlock(color, moves) {
    const opp = 3 - color
    for (const m of moves) {
      const five = this.place(m, opp)
      this.remove(m, opp)
      if (five) return m
    }
    return null
  }
}

/**
 * AI 思考
 * @param {{ moves: number[], rules: object, level: string }} req
 * @returns {{ move: number, time: number }}
 */
export function think({ moves = [], rules = {}, level = "普通" }) {
  const start = Date.now()
  const search = new Search(moves, { forbidden: true, overline: "win", ...rules })
  const color = moves.length % 2 === 0 ? BLACK : WHITE
  const move = search.root(color, LEVELS[level] || LEVELS.普通)
  return { move, time: Date.now() - start, nodes: search.nodes }
}

/** 当前走子方的局势分（求和判断用，正数为当前方有利） */
export function evaluate({ moves = [], rules = {} }) {
  const search = new Search(moves, { forbidden: true, overline: "win", ...rules })
  const color = moves.length % 2 === 0 ? BLACK : WHITE
  return color === BLACK ? search.score : -search.score
}
