/**
 * 象棋 AI：迭代加深 + Alpha-Beta（PVS）+ 静态搜索 + 置换表 + 空着裁剪 + 杀手/历史启发
 */
import { Position, PIECE_VALUE, moveFrom, moveTo, iccsToMove, moveToIccs } from "./Board.js"
import { bookMove } from "./Book.js"

export const MATE = 30000
const WIN = MATE - 200 // 大于此值视为杀棋分
const BAN = 20000 // 长将判负分
const INF = 32000
const MAX_PLY = 64

const EXACT = 0
const LOWER = 1
const UPPER = 2

/** 难度设置 */
export const LEVELS = {
  入门: { depth: 2, noise: 150, random: 0.25, book: false },
  简单: { depth: 3, noise: 40, random: 0, book: true },
  普通: { time: 1500, noise: 0, book: true },
  困难: { time: 6000, noise: 0, book: true },
}
export const LEVEL_NAMES = Object.keys(LEVELS)

export class Engine {
  constructor(ttBits = 19) {
    this.ttSize = 1 << ttBits
    this.ttMask = this.ttSize - 1
    this.ttLock = new Int32Array(this.ttSize)
    this.ttDepth = new Int8Array(this.ttSize)
    this.ttFlag = new Uint8Array(this.ttSize)
    this.ttScore = new Int16Array(this.ttSize)
    this.ttMove = new Int16Array(this.ttSize)
    this.history = new Int32Array(90 * 90)
    this.killers = []
  }

  /* ---------- 置换表 ---------- */

  probe(pos, depth, alpha, beta, ply) {
    const i = pos.lo & this.ttMask
    if (this.ttLock[i] !== pos.hi) return null
    const move = this.ttMove[i]
    if (this.ttDepth[i] < depth) return { move }
    let score = this.ttScore[i]
    if (score > WIN) score -= ply
    else if (score < -WIN) score += ply
    const flag = this.ttFlag[i]
    if (flag === EXACT || (flag === LOWER && score >= beta) || (flag === UPPER && score <= alpha)) return { move, score }
    return { move }
  }

  store(pos, depth, flag, score, move, ply) {
    const i = pos.lo & this.ttMask
    if (this.ttLock[i] === pos.hi && this.ttDepth[i] > depth && flag !== EXACT) return
    if (score > WIN) score += ply
    else if (score < -WIN) score -= ply
    this.ttLock[i] = pos.hi
    this.ttDepth[i] = depth
    this.ttFlag[i] = flag
    this.ttScore[i] = score
    this.ttMove[i] = move
  }

  /* ---------- 搜索 ---------- */

  timeUp() {
    if ((++this.nodes & 1023) === 0 && this.deadline && Date.now() > this.deadline) this.stopped = true
    return this.stopped
  }

  /** 重复局面打分：0 不重复；否则返回当前走子方视角的分数 */
  repetition(pos) {
    const keys = pos.keys
    const n = keys.length - 1
    for (let j = n - 2; j >= 0; j -= 2) {
      if (pos.caps[j + 1] || pos.caps[j + 2]) return null
      if (keys[j] !== keys[n]) continue
      let moverChecks = true
      let otherChecks = true
      for (let i = n; i > j; i -= 2) if (!pos.checks[i]) moverChecks = false
      for (let i = n - 1; i > j; i -= 2) if (!pos.checks[i]) otherChecks = false
      if (moverChecks && !otherChecks) return BAN
      if (otherChecks && !moverChecks) return -BAN
      return 0
    }
    return null
  }

  orderMoves(pos, moves, ttMove, ply) {
    const b = pos.board
    const killers = this.killers[ply] || []
    const scores = new Int32Array(moves.length)
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]
      const victim = b[moveTo(m)]
      if (m === ttMove) scores[i] = 1 << 30
      else if (victim) scores[i] = (1 << 28) + PIECE_VALUE[Math.abs(victim)] * 16 - PIECE_VALUE[Math.abs(b[moveFrom(m)])] / 16
      else if (m === killers[0]) scores[i] = 1 << 27
      else if (m === killers[1]) scores[i] = (1 << 27) - 1
      else scores[i] = this.history[moveFrom(m) * 90 + moveTo(m)]
    }
    const idx = moves.map((_, i) => i).sort((a, c) => scores[c] - scores[a])
    return idx.map(i => moves[i])
  }

  quiesce(pos, alpha, beta, ply) {
    if (this.timeUp()) return 0
    const inCheck = pos.inCheck()
    pos.checks[pos.checks.length - 1] = inCheck
    if (ply > 0) {
      const rep = this.repetition(pos)
      if (rep !== null) return rep
    }
    if (ply >= MAX_PLY) return pos.evaluate()
    let best = -INF
    if (!inCheck) {
      best = pos.evaluate()
      if (best >= beta) return best
      if (best > alpha) alpha = best
    }
    const moves = this.orderMoves(pos, pos.genMoves(!inCheck), 0, MAX_PLY)
    const side = pos.side
    let legal = 0
    for (const m of moves) {
      pos.makeMove(m)
      if (pos.inCheck(side)) {
        pos.unmakeMove()
        continue
      }
      legal++
      const score = -this.quiesce(pos, -beta, -alpha, ply + 1)
      pos.unmakeMove()
      if (this.stopped) return 0
      if (score > best) {
        best = score
        if (score > alpha) {
          alpha = score
          if (score >= beta) return score
        }
      }
    }
    if (inCheck && !legal) return -MATE + ply
    return best
  }

  negamax(pos, depth, alpha, beta, ply, allowNull) {
    if (this.timeUp()) return 0
    const inCheck = pos.inCheck()
    pos.checks[pos.checks.length - 1] = inCheck
    if (ply > 0) {
      const rep = this.repetition(pos)
      if (rep !== null) return rep
      // 杀棋距离裁剪
      alpha = Math.max(alpha, -MATE + ply)
      beta = Math.min(beta, MATE - ply - 1)
      if (alpha >= beta) return alpha
    }
    if (inCheck && ply < MAX_PLY) depth++
    if (depth <= 0 || ply >= MAX_PLY) return this.quiesce(pos, alpha, beta, ply)

    const tt = this.probe(pos, depth, alpha, beta, ply)
    if (tt?.score !== undefined && ply > 0) return tt.score
    const ttMove = tt?.move || 0

    const side = pos.side
    if (allowNull && !inCheck && depth >= 3 && beta < WIN && beta - alpha === 1 && pos.hasMajor(side)) {
      pos.makeNull()
      const score = -this.negamax(pos, depth - 3, -beta, -beta + 1, ply + 1, false)
      pos.unmakeNull()
      if (this.stopped) return 0
      if (score >= beta) return beta
    }

    const moves = this.orderMoves(pos, pos.genMoves(), ttMove, ply)
    let best = -INF
    let bestMove = 0
    let legal = 0
    const alpha0 = alpha
    for (const m of moves) {
      const capture = pos.board[moveTo(m)] !== 0
      pos.makeMove(m)
      if (pos.inCheck(side)) {
        pos.unmakeMove()
        continue
      }
      legal++
      let score
      if (legal === 1) {
        score = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true)
      } else {
        // 后面的着法先用零窗口试探，较晚的安静着法减一层
        const reduce = !inCheck && !capture && depth >= 3 && legal > 4 ? 1 : 0
        score = -this.negamax(pos, depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, true)
        if (score > alpha && (reduce || score < beta)) score = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true)
      }
      pos.unmakeMove()
      if (this.stopped) return 0
      if (score > best) {
        best = score
        bestMove = m
        if (ply === 0) this.rootBest = m
        if (score > alpha) {
          alpha = score
          if (score >= beta) {
            if (!capture) {
              const k = (this.killers[ply] ||= [0, 0])
              if (k[0] !== m) {
                k[1] = k[0]
                k[0] = m
              }
              this.history[moveFrom(m) * 90 + moveTo(m)] += depth * depth
            }
            break
          }
        }
      }
    }
    // 象棋中无子可走（含困毙）即判负
    if (!legal) return -MATE + ply
    this.store(pos, depth, best >= beta ? LOWER : best > alpha0 ? EXACT : UPPER, best, bestMove, ply)
    return best
  }

  /** 每个根着法单独完整打分（低难度加噪声用） */
  scoreRoot(pos, depth) {
    const side = pos.side
    const list = []
    for (const m of pos.genMoves()) {
      pos.makeMove(m)
      if (pos.inCheck(side)) {
        pos.unmakeMove()
        continue
      }
      const score = -this.negamax(pos, depth - 1, -INF, INF, 1, true)
      pos.unmakeMove()
      list.push({ move: m, score })
    }
    return list.sort((a, b) => b.score - a.score)
  }

  /**
   * 搜索最佳着法
   * @param {Position} pos
   * @param {object} opt { time, depth, noise, random }
   */
  search(pos, { time = 0, depth = 0, noise = 0, random = 0 } = {}) {
    this.nodes = 0
    this.stopped = false
    this.deadline = time ? Date.now() + time : 0
    this.killers = []
    this.history.fill(0)
    const start = Date.now()

    if (noise || random) {
      const list = this.scoreRoot(pos, depth || 2)
      if (!list.length) return null
      let pick
      // 有杀棋时不加噪声，直接走
      if (list[0].score > WIN) pick = list[0]
      else if (random && Math.random() < random) pick = list[Math.floor(Math.random() * Math.min(5, list.length))]
      else pick = list.map(i => ({ ...i, v: Math.abs(i.score) > WIN ? i.score : i.score + (Math.random() * 2 - 1) * noise })).sort((a, b) => b.v - a.v)[0]
      return { move: pick.move, score: pick.score, depth: depth || 2, nodes: this.nodes, time: Date.now() - start }
    }

    let result = null
    const maxDepth = depth || 40
    for (let d = 1; d <= maxDepth; d++) {
      this.rootBest = 0
      const score = this.negamax(pos, d, -INF, INF, 0, false)
      if (this.stopped) {
        // 未完成的一层：首个着法已搜完且优于上一层时也可采用
        break
      }
      if (this.rootBest) result = { move: this.rootBest, score, depth: d }
      if (Math.abs(score) > WIN) break
      // 剩余时间不足以再搜一层时提前结束
      if (this.deadline && Date.now() - start > (this.deadline - start) * 0.45) break
    }
    if (!result) {
      const legal = pos.legalMoves()
      if (!legal.length) return null
      result = { move: legal[0], score: 0, depth: 0 }
    }
    return { ...result, nodes: this.nodes, time: Date.now() - start }
  }
}

/**
 * 根据棋谱思考（供 Worker 和主线程共用）
 * @param {{ fen: string, moves: string[], level: string }} req
 * @returns {{ iccs: string, score: number, depth: number, nodes: number, time: number, book?: boolean } | null}
 */
export function think({ fen, moves = [], level = "普通" }) {
  const cfg = LEVELS[level] || LEVELS.普通
  const pos = Position.fromFen(fen)
  for (const iccs of moves) pos.play(iccsToMove(iccs))
  if (cfg.book) {
    const book = bookMove(fen, moves, pos)
    if (book) return { iccs: book, score: 0, depth: 0, nodes: 0, time: 0, book: true }
  }
  const engine = new Engine()
  const res = engine.search(pos, cfg)
  if (!res) return null
  return { iccs: moveToIccs(res.move), score: res.score, depth: res.depth, nodes: res.nodes, time: res.time }
}

/** 快速评估当前走子方的局势（求和判断用） */
export function evaluateFor({ fen, moves = [] }) {
  const pos = Position.fromFen(fen)
  for (const iccs of moves) pos.play(iccsToMove(iccs))
  const res = new Engine(16).search(pos, { depth: 3 })
  return res ? res.score : 0
}
