/**
 * 终局数子：用随机模拟估算死子
 *
 * 从当前局面出发随机下完很多盘（不填自己的眼），统计每个交叉点最后归哪一方。
 * 一块棋的子在大多数模拟里都变成了对方的，就认定为死子。
 * 局面下清楚时估算很准；双活、复杂对杀可能出错，所以要双方确认。
 *
 * 模拟用专门的快速棋盘：并查集维护棋块，伪气数（每个相邻空点算一次）判断提子，
 * 空点列表增量维护，单盘模拟只要零点几毫秒。
 */
import { GoGame, neighbors, groupAt, EMPTY, BLACK, WHITE } from "./Board.js"

const PLAYOUTS = { 9: 600, 13: 400, 19: 300 }
const DEAD_THRESHOLD = 0

/** 可复现的随机数 */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class FastBoard {
  constructor(size, start) {
    const n = size * size
    this.size = size
    this.n = n
    this.nb = neighbors(size)
    this.color = new Uint8Array(n)
    this.parent = new Int32Array(n)
    this.next = new Int32Array(n) // 同一棋块的子组成环形链表
    this.libs = new Int32Array(n) // 根节点上的伪气数
    this.empties = new Int32Array(n)
    this.where = new Int32Array(n)
    this.emptyCount = 0
    for (let i = 0; i < n; i++) this.addEmpty(i)
    for (let i = 0; i < n; i++) if (start[i]) this.put(i, start[i])
  }

  addEmpty(i) {
    this.where[i] = this.emptyCount
    this.empties[this.emptyCount++] = i
  }

  removeEmpty(i) {
    const k = this.where[i]
    const last = this.empties[--this.emptyCount]
    this.empties[k] = last
    this.where[last] = k
  }

  find(i) {
    let r = i
    while (this.parent[r] !== r) r = this.parent[r]
    while (this.parent[i] !== r) {
      const p = this.parent[i]
      this.parent[i] = r
      i = p
    }
    return r
  }

  /** 是否合法（不自杀） */
  legal(p, c) {
    const { nb, color } = this
    for (const q of nb[p]) if (!color[q]) return true
    // 统计每个相邻棋块与 p 相邻的次数
    const seen = []
    for (const q of nb[p]) {
      const g = this.find(q)
      if (seen.includes(g)) continue
      seen.push(g)
      let adj = 0
      for (const r of nb[p]) if (color[r] && this.find(r) === g) adj++
      const rest = this.libs[g] - adj
      if (color[q] === c && rest > 0) return true // 连上一块还有气的己方棋
      if (color[q] !== c && rest === 0) return true // 能提掉对方
    }
    return false
  }

  put(p, c) {
    const { nb, color, parent, next, libs } = this
    color[p] = c
    parent[p] = p
    next[p] = p
    libs[p] = 0
    this.removeEmpty(p)
    for (const q of nb[p]) if (!color[q]) libs[p]++
    const captureRoots = []
    for (const q of nb[p]) {
      if (!color[q]) continue
      const g = this.find(q)
      libs[g]--
      if (color[q] === c) {
        const r = this.find(p)
        if (g !== r) {
          // 合并：链表拼接，伪气相加
          parent[g] = r
          libs[r] += libs[g]
          const t = next[r]
          next[r] = next[g]
          next[g] = t
        }
      }
    }
    for (const q of nb[p]) {
      if (color[q] && color[q] !== c) {
        const g = this.find(q)
        if (libs[g] === 0 && !captureRoots.includes(g)) captureRoots.push(g)
      }
    }
    for (const g of captureRoots) this.removeGroup(g)
  }

  removeGroup(g) {
    const { nb, color, next, libs } = this
    const stones = []
    let s = g
    do {
      stones.push(s)
      s = next[s]
    } while (s !== g)
    for (const st of stones) {
      color[st] = EMPTY
      this.addEmpty(st)
    }
    for (const st of stones) {
      for (const q of nb[st]) if (color[q]) libs[this.find(q)]++
    }
  }

  isEye(p, c) {
    for (const q of this.nb[p]) if (this.color[q] !== c) return false
    return true
  }

  /** 随机下一步，没有可下的点返回 false */
  randomMove(c, random) {
    const count = this.emptyCount
    if (!count) return false
    const start = Math.floor(random() * count)
    for (let k = 0; k < count; k++) {
      const p = this.empties[(start + k) % count]
      if (this.isEye(p, c) || !this.legal(p, c)) continue
      this.put(p, c)
      return true
    }
    return false
  }
}

/** 随机下完一盘，把终局归属累加到 sum（黑 +1，白 -1） */
function playout(start, size, side, random, sum) {
  const b = new FastBoard(size, start)
  let passes = 0
  let c = side
  for (let move = 0; move < b.n * 3 && passes < 2; move++) {
    passes = b.randomMove(c, random) ? 0 : passes + 1
    c = 3 - c
  }
  const { color, nb } = b
  for (let i = 0; i < b.n; i++) {
    if (color[i]) sum[i] += color[i] === BLACK ? 1 : -1
    else {
      let bl = 0
      let wh = 0
      for (const j of nb[i]) {
        if (color[j] === BLACK) bl++
        else if (color[j] === WHITE) wh++
      }
      if (bl && !wh) sum[i]++
      else if (wh && !bl) sum[i]--
    }
  }
}

/** 估算每点归属（黑为正，-1~1）；两方轮流先走各一半，减少先手偏差 */
export function ownership(game, { playouts, seed = 12345 } = {}) {
  const size = game.size
  const count = playouts || PLAYOUTS[size] || 300
  const random = rng(seed)
  const sum = new Float32Array(size * size)
  for (let k = 0; k < count; k++) playout(game.cells, size, k % 2 ? WHITE : BLACK, random, sum)
  for (let i = 0; i < sum.length; i++) sum[i] /= count
  return sum
}

/** 根据归属估算找出死子：一块棋平均归属偏向对方即为死子 */
export function deadStones(game, own) {
  const size = game.size
  const seen = new Uint8Array(size * size)
  const dead = []
  for (let i = 0; i < game.cells.length; i++) {
    const c = game.cells[i]
    if (c === EMPTY || seen[i]) continue
    const { stones } = groupAt(game.cells, size, i)
    let total = 0
    for (const s of stones) {
      seen[s] = 1
      total += own[s]
    }
    const mean = (total / stones.length) * (c === BLACK ? 1 : -1)
    if (mean < DEAD_THRESHOLD) dead.push(...stones)
  }
  return dead.sort((a, b) => a - b)
}

/**
 * 数子分析（供线程和主线程共用）
 * @param {object} data GoGame.toJSON() 的内容
 * @returns {{ dead: number[], black, white, komi, diff, winner, owner: number[] }}
 */
export function analyze(data) {
  const game = GoGame.fromJSON({ ...data, result: null })
  const own = ownership(game, { playouts: data.playouts })
  const dead = deadStones(game, own)
  const s = game.score(dead)
  return { dead, black: s.black, white: s.white, komi: s.komi, diff: s.diff, winner: s.winner, owner: [...s.owner] }
}
