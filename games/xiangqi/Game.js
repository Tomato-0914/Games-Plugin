/**
 * 一局象棋：走子记录、悔棋、胜负判定、存档
 */
import { Position, START_FEN, RED, BLACK, moveToIccs, iccsToMove } from "./Board.js"
import { moveToChinese, parseMove } from "./Notation.js"

export const RESULT_REASON = {
  checkmate: "绝杀",
  stalemate: "困毙",
  resign: "认输",
  timeout: "超时",
  perpetual: "长将",
  repetition: "重复局面",
  natural: "自然限着",
  material: "双方均无进攻子力",
  agreed: "双方同意和棋",
}

export class XiangqiGame {
  /**
   * @param {object} opt
   * @param {string} [opt.fen] 起始局面
   * @param {string[]} [opt.moves] 已走的 ICCS 走法
   * @param {number} [opt.naturalLimit] 自然限着回合数
   */
  constructor({ fen = START_FEN, moves = [], naturalLimit = 60 } = {}) {
    this.startFen = fen
    this.naturalLimit = naturalLimit
    this.pos = Position.fromFen(fen)
    /** [{ move, iccs, cn, captured, check }] */
    this.records = []
    this.result = null
    for (const iccs of moves) {
      const m = iccsToMove(iccs)
      if (!this.pos.legalMoves().includes(m)) throw new Error(`棋谱中有非法走法：${iccs}`)
      this.apply(m)
    }
    this.judge()
  }

  get side() {
    return this.pos.side
  }

  get moveCount() {
    return this.records.length
  }

  /** 第几回合（红黑各走一步为一回合） */
  get round() {
    return Math.floor(this.records.length / 2) + 1
  }

  get lastRecord() {
    return this.records[this.records.length - 1]
  }

  get inCheck() {
    return this.pos.inCheck()
  }

  legalMoves() {
    return this.pos.legalMoves()
  }

  parse(text) {
    return parseMove(this.pos, text)
  }

  apply(m) {
    const cn = moveToChinese(this.pos, m)
    const captured = this.pos.play(m)
    const rec = { move: m, iccs: moveToIccs(m), cn, captured, check: this.pos.inCheck() }
    this.records.push(rec)
    return rec
  }

  /** 走一步，返回记录；终局时 this.result 被设置 */
  play(m) {
    if (this.result) throw new Error("对局已结束")
    const rec = this.apply(m)
    this.judge()
    return rec
  }

  /** 撤回 n 步 */
  undo(n = 1) {
    n = Math.min(n, this.records.length)
    for (let i = 0; i < n; i++) {
      this.pos.unmakeMove()
      this.records.pop()
    }
    this.result = null
    return n
  }

  end(winner, reason) {
    this.result = { winner, reason }
    return this.result
  }

  /** 自上次吃子以来的步数 */
  pliesSinceCapture() {
    let n = 0
    for (let i = this.records.length - 1; i >= 0 && !this.records[i].captured; i--) n++
    return n
  }

  judge() {
    const pos = this.pos
    const side = pos.side
    if (!pos.legalMoves().length) {
      return this.end(-side, pos.inCheck() ? "checkmate" : "stalemate")
    }

    // 重复局面：当前局面第 3 次出现
    const keys = pos.keys
    const n = keys.length - 1
    const seen = []
    for (let j = n - 2; j >= 0; j -= 2) {
      if (pos.caps[j + 1] || pos.caps[j + 2]) break
      if (keys[j] === keys[n]) seen.push(j)
    }
    if (seen.length >= 2) {
      const first = seen[seen.length - 1]
      // 刚走完的一方（mover）的走法产生的局面：n, n-2, ...；对方：n-1, n-3, ...
      const allCheck = start => {
        for (let i = start; i > first; i -= 2) if (!pos.checks[i]) return false
        return true
      }
      const moverChecks = allCheck(n)
      const otherChecks = allCheck(n - 1)
      if (moverChecks && !otherChecks) return this.end(side, "perpetual")
      if (otherChecks && !moverChecks) return this.end(-side, "perpetual")
      return this.end(0, "repetition")
    }

    if (this.naturalLimit > 0 && this.pliesSinceCapture() >= this.naturalLimit * 2) {
      return this.end(0, "natural")
    }
    if (!pos.hasAttackers(RED) && !pos.hasAttackers(BLACK)) {
      return this.end(0, "material")
    }
    return null
  }

  toJSON() {
    return { fen: this.startFen, moves: this.records.map(r => r.iccs), naturalLimit: this.naturalLimit, result: this.result }
  }

  static fromJSON(data) {
    const game = new XiangqiGame({ fen: data.fen, moves: data.moves, naturalLimit: data.naturalLimit })
    if (data.result) game.result = data.result
    return game
  }
}

export { RED, BLACK }
