/**
 * 中国象棋棋盘与走法生成
 *
 * 坐标：sq = r * 9 + c
 *   r = 0 是黑方底线（ICCS 第 9 行），r = 9 是红方底线（ICCS 第 0 行）
 *   c = 0 是 a 列（红方左手边），c = 8 是 i 列
 * 棋子：正数红方，负数黑方，绝对值见下方常量
 * 走法：整数 from | (to << 7)
 */

export const RED = 1
export const BLACK = -1

export const KING = 1
export const ADVISOR = 2
export const BISHOP = 3
export const KNIGHT = 4
export const ROOK = 5
export const CANNON = 6
export const PAWN = 7

export const START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w"

export const rowOf = sq => (sq / 9) | 0
export const colOf = sq => sq % 9
export const sqOf = (r, c) => r * 9 + c
export const moveFrom = m => m & 127
export const moveTo = m => m >> 7
export const makeMove = (from, to) => from | (to << 7)

const inBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9
const inPalace = (r, c, side) => c >= 3 && c <= 5 && (side === RED ? r >= 7 : r <= 2)
/** 是否在己方半场（没过河） */
export const ownHalf = (r, side) => (side === RED ? r >= 5 : r <= 4)

const FEN_PIECE = { k: KING, a: ADVISOR, b: BISHOP, e: BISHOP, n: KNIGHT, h: KNIGHT, r: ROOK, c: CANNON, p: PAWN }
const PIECE_FEN = ["", "k", "a", "b", "n", "r", "c", "p"]

/* ---------------- 预计算走法表 ---------------- */

const KNIGHT_MOVES = [] // [to, leg]
const KNIGHT_ATTACKERS = [] // 能攻击此格的马：[from, leg]
const BISHOP_MOVES = [] // [to, eye]
const ADVISOR_MOVES = []
const KING_MOVES = []
const RAYS = [] // 4 个方向上的格子列表：上、下、左、右

for (let sq = 0; sq < 90; sq++) {
  KNIGHT_ATTACKERS[sq] = []
}
for (let sq = 0; sq < 90; sq++) {
  const r = rowOf(sq)
  const c = colOf(sq)
  KNIGHT_MOVES[sq] = []
  for (const [dr, dc] of [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]]) {
    if (!inBoard(r + dr, c + dc)) continue
    const leg = Math.abs(dr) === 2 ? sqOf(r + dr / 2, c) : sqOf(r, c + dc / 2)
    const to = sqOf(r + dr, c + dc)
    KNIGHT_MOVES[sq].push([to, leg])
    KNIGHT_ATTACKERS[to].push([sq, leg])
  }
  BISHOP_MOVES[sq] = []
  for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
    if (!inBoard(r + dr, c + dc)) continue
    BISHOP_MOVES[sq].push([sqOf(r + dr, c + dc), sqOf(r + dr / 2, c + dc / 2)])
  }
  ADVISOR_MOVES[sq] = []
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    if (inBoard(r + dr, c + dc)) ADVISOR_MOVES[sq].push(sqOf(r + dr, c + dc))
  }
  KING_MOVES[sq] = []
  RAYS[sq] = []
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    if (inBoard(r + dr, c + dc)) KING_MOVES[sq].push(sqOf(r + dr, c + dc))
    const ray = []
    for (let rr = r + dr, cc = c + dc; inBoard(rr, cc); rr += dr, cc += dc) ray.push(sqOf(rr, cc))
    RAYS[sq].push(ray)
  }
}

/* ---------------- 位置分（含子力价值，红方视角，r=0 为对方底线） ---------------- */

const Z = Array(9).fill(0)
const PST = []
PST[KING] = [
  Z, Z, Z, Z, Z, Z, Z,
  [0, 0, 0, 1, 1, 1, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 0, 0, 0],
  [0, 0, 0, 11, 15, 11, 0, 0, 0],
].flat()
PST[ADVISOR] = [
  Z, Z, Z, Z, Z, Z, Z,
  [0, 0, 0, 20, 0, 20, 0, 0, 0],
  [0, 0, 0, 0, 23, 0, 0, 0, 0],
  [0, 0, 0, 20, 0, 20, 0, 0, 0],
].flat()
PST[BISHOP] = [
  Z, Z, Z, Z, Z,
  [0, 0, 20, 0, 0, 0, 20, 0, 0],
  Z,
  [18, 0, 0, 0, 23, 0, 0, 0, 18],
  Z,
  [0, 0, 20, 0, 0, 0, 20, 0, 0],
].flat()
PST[KNIGHT] = [
  [90, 90, 90, 96, 90, 96, 90, 90, 90],
  [90, 96, 103, 97, 94, 97, 103, 96, 90],
  [92, 98, 99, 103, 99, 103, 99, 98, 92],
  [93, 108, 100, 107, 100, 107, 100, 108, 93],
  [90, 100, 99, 103, 104, 103, 99, 100, 90],
  [90, 98, 101, 102, 103, 102, 101, 98, 90],
  [92, 94, 98, 95, 98, 95, 98, 94, 92],
  [93, 92, 94, 95, 92, 95, 94, 92, 93],
  [85, 90, 92, 93, 78, 93, 92, 90, 85],
  [88, 85, 90, 88, 90, 88, 90, 85, 88],
].flat()
PST[ROOK] = [
  [206, 208, 207, 213, 214, 213, 207, 208, 206],
  [206, 212, 209, 216, 233, 216, 209, 212, 206],
  [206, 208, 207, 214, 216, 214, 207, 208, 206],
  [206, 213, 213, 216, 216, 216, 213, 213, 206],
  [208, 211, 211, 214, 215, 214, 211, 211, 208],
  [208, 212, 212, 214, 215, 214, 212, 212, 208],
  [204, 209, 204, 212, 214, 212, 204, 209, 204],
  [198, 208, 204, 212, 212, 212, 204, 208, 198],
  [200, 208, 206, 212, 200, 212, 206, 208, 200],
  [194, 206, 204, 212, 200, 212, 204, 206, 194],
].flat()
PST[CANNON] = [
  [100, 100, 96, 91, 90, 91, 96, 100, 100],
  [98, 98, 96, 92, 89, 92, 96, 98, 98],
  [97, 97, 96, 91, 92, 91, 96, 97, 97],
  [96, 99, 99, 98, 100, 98, 99, 99, 96],
  [96, 96, 96, 96, 100, 96, 96, 96, 96],
  [95, 96, 99, 96, 100, 96, 99, 96, 95],
  [96, 96, 96, 96, 96, 96, 96, 96, 96],
  [97, 96, 100, 99, 101, 99, 100, 96, 97],
  [96, 97, 98, 98, 98, 98, 98, 97, 96],
  [96, 96, 97, 99, 99, 99, 97, 96, 96],
].flat()
PST[PAWN] = [
  [9, 9, 9, 11, 13, 11, 9, 9, 9],
  [19, 24, 34, 42, 44, 42, 34, 24, 19],
  [19, 24, 32, 37, 37, 37, 32, 24, 19],
  [19, 23, 27, 29, 30, 29, 27, 23, 19],
  [14, 18, 20, 27, 29, 27, 20, 18, 14],
  [7, 0, 13, 0, 16, 0, 13, 0, 7],
  [7, 0, 7, 0, 15, 0, 7, 0, 7],
  Z, Z, Z,
].flat()

/** 棋子价值（用于吃子排序） */
export const PIECE_VALUE = [0, 10000, 20, 20, 90, 200, 95, 30]

const mirror = sq => sqOf(9 - rowOf(sq), colOf(sq))
const pstValue = (p, sq) => (p > 0 ? PST[p][sq] : PST[-p][mirror(sq)])

/* ---------------- Zobrist ---------------- */

let seed = 0x2f6b3c1d
function rand32() {
  // xorshift32，固定种子保证每次启动一致
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return seed | 0
}
const ZLO = []
const ZHI = []
for (let p = 0; p < 15; p++) {
  ZLO[p] = new Int32Array(90)
  ZHI[p] = new Int32Array(90)
  for (let sq = 0; sq < 90; sq++) {
    ZLO[p][sq] = rand32()
    ZHI[p][sq] = rand32()
  }
}
const ZSIDE_LO = rand32()
const ZSIDE_HI = rand32()

/* ---------------- 局面 ---------------- */

export class Position {
  constructor() {
    this.board = new Int8Array(90)
    this.side = RED
    this.lo = 0
    this.hi = 0
    this.kingSq = { [RED]: -1, [BLACK]: -1 }
    this.vRed = 0
    this.vBlack = 0
    /** 走子栈：[move, captured, lo, hi] */
    this.stack = []
    /** 每个局面的哈希、是否被将军、到达该局面的一步是否吃子，用于判断重复局面 */
    this.keys = []
    this.checks = []
    this.caps = []
  }

  static fromFen(fen = START_FEN) {
    const pos = new Position()
    const [placement, side = "w"] = fen.trim().split(/\s+/)
    const rows = placement.split("/")
    if (rows.length !== 10) throw new Error("FEN 行数错误")
    rows.forEach((row, r) => {
      let c = 0
      for (const ch of row) {
        if (/\d/.test(ch)) {
          c += Number(ch)
          continue
        }
        const type = FEN_PIECE[ch.toLowerCase()]
        if (!type || c > 8) throw new Error(`FEN 字符错误：${ch}`)
        pos.put(sqOf(r, c), ch === ch.toUpperCase() ? type : -type)
        c++
      }
      if (c !== 9) throw new Error("FEN 列数错误")
    })
    if (side === "b") {
      pos.side = BLACK
      pos.lo ^= ZSIDE_LO
      pos.hi ^= ZSIDE_HI
    }
    if (pos.kingSq[RED] < 0 || pos.kingSq[BLACK] < 0) throw new Error("FEN 缺少将帅")
    pos.resetHistory()
    return pos
  }

  resetHistory() {
    this.keys = [this.key]
    this.checks = [this.inCheck()]
    this.caps = [false]
  }

  toFen() {
    const rows = []
    for (let r = 0; r < 10; r++) {
      let row = ""
      let empty = 0
      for (let c = 0; c < 9; c++) {
        const p = this.board[sqOf(r, c)]
        if (!p) {
          empty++
          continue
        }
        if (empty) row += empty
        empty = 0
        const ch = PIECE_FEN[Math.abs(p)]
        row += p > 0 ? ch.toUpperCase() : ch
      }
      if (empty) row += empty
      rows.push(row)
    }
    return `${rows.join("/")} ${this.side === RED ? "w" : "b"}`
  }

  /** 53 位局面键，可直接比较 */
  get key() {
    return (this.hi >>> 11) * 4294967296 + (this.lo >>> 0)
  }

  put(sq, p) {
    this.board[sq] = p
    this.lo ^= ZLO[p + 7][sq]
    this.hi ^= ZHI[p + 7][sq]
    if (p > 0) this.vRed += pstValue(p, sq)
    else this.vBlack += pstValue(p, sq)
    if (p === KING) this.kingSq[RED] = sq
    else if (p === -KING) this.kingSq[BLACK] = sq
  }

  remove(sq) {
    const p = this.board[sq]
    this.board[sq] = 0
    this.lo ^= ZLO[p + 7][sq]
    this.hi ^= ZHI[p + 7][sq]
    if (p > 0) this.vRed -= pstValue(p, sq)
    else this.vBlack -= pstValue(p, sq)
    return p
  }

  makeMove(m) {
    const from = moveFrom(m)
    const to = moveTo(m)
    const lo = this.lo
    const hi = this.hi
    const captured = this.board[to] ? this.remove(to) : 0
    this.put(to, this.remove(from))
    this.side = -this.side
    this.lo ^= ZSIDE_LO
    this.hi ^= ZSIDE_HI
    this.stack.push(m, captured, lo, hi)
    this.keys.push(this.key)
    this.checks.push(false) // 由调用方按需写入
    this.caps.push(captured !== 0)
    return captured
  }

  unmakeMove() {
    const hi = this.stack.pop()
    const lo = this.stack.pop()
    const captured = this.stack.pop()
    const m = this.stack.pop()
    const from = moveFrom(m)
    const to = moveTo(m)
    this.put(from, this.remove(to))
    if (captured) this.put(to, captured)
    this.side = -this.side
    this.lo = lo
    this.hi = hi
    this.keys.pop()
    this.checks.pop()
    this.caps.pop()
  }

  makeNull() {
    this.side = -this.side
    this.lo ^= ZSIDE_LO
    this.hi ^= ZSIDE_HI
    this.keys.push(this.key)
    this.checks.push(false)
    this.caps.push(true) // 空着不参与重复判断
  }

  unmakeNull() {
    this.side = -this.side
    this.lo ^= ZSIDE_LO
    this.hi ^= ZSIDE_HI
    this.keys.pop()
    this.checks.pop()
    this.caps.pop()
  }

  /** 当前走子方视角的局面分 */
  evaluate() {
    return (this.side === RED ? this.vRed - this.vBlack : this.vBlack - this.vRed) + 3
  }

  /** sq 是否受到 by 方攻击（只用于将帅所在格：含将帅照面） */
  isAttacked(sq, by) {
    const b = this.board
    const rays = RAYS[sq]
    for (let d = 0; d < 4; d++) {
      const ray = rays[d]
      let i = 0
      for (; i < ray.length; i++) {
        const p = b[ray[i]]
        if (!p) continue
        if (p === by * ROOK) return true
        if (d < 2 && p === by * KING) return true
        break
      }
      for (i++; i < ray.length; i++) {
        const p = b[ray[i]]
        if (!p) continue
        if (p === by * CANNON) return true
        break
      }
    }
    for (const [from, leg] of KNIGHT_ATTACKERS[sq]) {
      if (b[from] === by * KNIGHT && !b[leg]) return true
    }
    const r = rowOf(sq)
    const c = colOf(sq)
    const pawn = by * PAWN
    if (by === RED) {
      if (r < 9 && b[sq + 9] === pawn) return true
      if (r <= 4 && ((c > 0 && b[sq - 1] === pawn) || (c < 8 && b[sq + 1] === pawn))) return true
    } else {
      if (r > 0 && b[sq - 9] === pawn) return true
      if (r >= 5 && ((c > 0 && b[sq - 1] === pawn) || (c < 8 && b[sq + 1] === pawn))) return true
    }
    return false
  }

  inCheck(side = this.side) {
    return this.isAttacked(this.kingSq[side], -side)
  }

  /** 伪合法走法（不检查走后是否被将） */
  genMoves(capturesOnly = false, out = []) {
    const b = this.board
    const s = this.side
    for (let sq = 0; sq < 90; sq++) {
      const p = b[sq]
      if (!p || (p > 0) !== (s > 0)) continue
      const add = to => {
        const t = b[to]
        if (t ? (t > 0) !== (s > 0) : !capturesOnly) out.push(sq | (to << 7))
      }
      switch (p * s) {
        case KING:
          for (const to of KING_MOVES[sq]) if (inPalace(rowOf(to), colOf(to), s)) add(to)
          break
        case ADVISOR:
          for (const to of ADVISOR_MOVES[sq]) if (inPalace(rowOf(to), colOf(to), s)) add(to)
          break
        case BISHOP:
          for (const [to, eye] of BISHOP_MOVES[sq]) if (!b[eye] && ownHalf(rowOf(to), s)) add(to)
          break
        case KNIGHT:
          for (const [to, leg] of KNIGHT_MOVES[sq]) if (!b[leg]) add(to)
          break
        case ROOK:
          for (const ray of RAYS[sq]) {
            for (const to of ray) {
              add(to)
              if (b[to]) break
            }
          }
          break
        case CANNON:
          for (const ray of RAYS[sq]) {
            let i = 0
            for (; i < ray.length; i++) {
              if (b[ray[i]]) break
              if (!capturesOnly) out.push(sq | (ray[i] << 7))
            }
            for (i++; i < ray.length; i++) {
              const t = b[ray[i]]
              if (!t) continue
              if ((t > 0) !== (s > 0)) out.push(sq | (ray[i] << 7))
              break
            }
          }
          break
        case PAWN: {
          const r = rowOf(sq)
          const c = colOf(sq)
          const fr = r - s
          if (fr >= 0 && fr <= 9) add(sqOf(fr, c))
          if (!ownHalf(r, s)) {
            if (c > 0) add(sq - 1)
            if (c < 8) add(sq + 1)
          }
          break
        }
      }
    }
    return out
  }

  /** 走后己方是否安全 */
  isLegal(m) {
    const side = this.side
    this.makeMove(m)
    const ok = !this.inCheck(side)
    this.unmakeMove()
    return ok
  }

  legalMoves() {
    return this.genMoves().filter(m => this.isLegal(m))
  }

  /** 走一步并记录走后是否将军（对局用） */
  play(m) {
    const captured = this.makeMove(m)
    this.checks[this.checks.length - 1] = this.inCheck()
    return captured
  }

  /** 是否还有能过河进攻的子力（车马炮兵） */
  hasAttackers(side) {
    for (let sq = 0; sq < 90; sq++) {
      const t = this.board[sq] * side
      if (t === ROOK || t === KNIGHT || t === CANNON || t === PAWN) return true
    }
    return false
  }

  /** 是否有车马炮（空着裁剪用） */
  hasMajor(side) {
    for (let sq = 0; sq < 90; sq++) {
      const t = this.board[sq] * side
      if (t === ROOK || t === KNIGHT || t === CANNON) return true
    }
    return false
  }
}

/* ---------------- ICCS 坐标 ---------------- */

export function sqToIccs(sq) {
  return "abcdefghi"[colOf(sq)] + (9 - rowOf(sq))
}

export function iccsToSq(str) {
  const m = /^([a-i])([0-9])$/i.exec(str)
  if (!m) return -1
  return sqOf(9 - Number(m[2]), m[1].toLowerCase().charCodeAt(0) - 97)
}

export function moveToIccs(m) {
  return sqToIccs(moveFrom(m)) + sqToIccs(moveTo(m))
}

export function iccsToMove(str) {
  const m = /^([a-i][0-9])-?([a-i][0-9])$/i.exec(String(str).trim())
  if (!m) return -1
  return makeMove(iccsToSq(m[1]), iccsToSq(m[2]))
}

/** 不合法走法的原因（from/to 已确定时） */
export function explainIllegal(pos, from, to) {
  const b = pos.board
  const s = pos.side
  const p = b[from]
  if (!p) return "起点没有棋子"
  if ((p > 0) !== (s > 0)) return "那是对方的棋子"
  if (from === to) return "起点和终点相同"
  const t = b[to]
  if (t && (t > 0) === (s > 0)) return "终点有自己的棋子"
  const m = makeMove(from, to)
  if (pos.genMoves().includes(m)) {
    pos.makeMove(m)
    const facing = (() => {
      const rk = pos.kingSq[RED]
      const bk = pos.kingSq[BLACK]
      if (colOf(rk) !== colOf(bk)) return false
      for (let sq = bk + 9; sq < rk; sq += 9) if (pos.board[sq]) return false
      return true
    })()
    pos.unmakeMove()
    return facing ? "走后将帅照面" : pos.inCheck() ? "你正被将军，这步不能解将" : "走后己方将帅会被吃"
  }
  const fr = rowOf(from)
  const fc = colOf(from)
  const tr = rowOf(to)
  const tc = colOf(to)
  const dr = tr - fr
  const dc = tc - fc
  const between = () => {
    let n = 0
    if (dr && dc) return -1
    const step = dr ? Math.sign(dr) * 9 : Math.sign(dc)
    for (let sq = from + step; sq !== to; sq += step) if (b[sq]) n++
    return n
  }
  switch (Math.abs(p)) {
    case KING:
      if (!inPalace(tr, tc, s)) return "将帅不能走出九宫"
      return "将帅每次只能直走一格"
    case ADVISOR:
      if (!inPalace(tr, tc, s)) return "仕士不能走出九宫"
      return "仕士每次只能斜走一格"
    case BISHOP:
      if (Math.abs(dr) !== 2 || Math.abs(dc) !== 2) return "相象只能走田字"
      if (!ownHalf(tr, s)) return "相象不能过河"
      if (b[sqOf(fr + dr / 2, fc + dc / 2)]) return "象眼被塞住了"
      break
    case KNIGHT:
      if (!((Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2))) return "马只能走日字"
      return "马腿被绊住了"
    case ROOK:
      if (dr && dc) return "车只能直线行走"
      return "车不能越过棋子"
    case CANNON: {
      if (dr && dc) return "炮只能直线行走"
      const n = between()
      if (t) return n === 0 ? "炮吃子需要隔一个棋子（炮架）" : "炮吃子只能隔一个棋子"
      return "炮不吃子时不能越过棋子"
    }
    case PAWN:
      if (dr === s) return "兵卒不能后退"
      if (dr === 0 && ownHalf(fr, s)) return "兵卒过河后才能横走"
      return "兵卒每次只能走一格"
  }
  return "不符合走法规则"
}
