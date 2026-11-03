/**
 * 中文纵线记谱：炮二平五、马8进7、前车进一……
 *
 * 解析思路：把所有合法走法都转成若干种“规范键”，输入也规范化后查表，
 * 这样各种写法（中文/阿拉伯数字、繁简字、前后车等）都能统一处理。
 */
import {
  RED, KING, ADVISOR, BISHOP, KNIGHT, ROOK, CANNON, PAWN,
  rowOf, colOf, sqOf, moveFrom, moveTo, iccsToMove, moveToIccs, explainIllegal,
} from "./Board.js"

const CN_NUM = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
const PIECE_NAME = {
  [RED]: ["", "帅", "仕", "相", "马", "车", "炮", "兵"],
  [-RED]: ["", "将", "士", "象", "马", "车", "炮", "卒"],
}
const KEY_PIECE = ["", "K", "A", "B", "N", "R", "C", "P"]

/** 输入里各种字 → 规范字符 */
const CHAR_MAP = {}
const addChars = (chars, to) => { for (const ch of chars) CHAR_MAP[ch] = to }
addChars("帅帥将將", "K")
addChars("仕士", "A")
addChars("相象", "B")
addChars("马馬傌", "N")
addChars("车車俥", "R")
addChars("炮砲包", "C")
addChars("兵卒", "P")
addChars("进進", "+")
addChars("退", "-")
addChars("平", "=")
addChars("前", "f")
addChars("中", "m")
addChars("后後", "b")
CN_NUM.forEach((ch, i) => { if (i) { CHAR_MAP[ch] = String(i); CHAR_MAP[String(i)] = String(i); CHAR_MAP[String.fromCharCode(0xff10 + i)] = String(i) } })

/** 匹配中文记谱的正则（不含前缀），供指令规则使用 */
export const CHINESE_MOVE_RE = /^[前中后後一二三四五1-5]?[帅帥将將仕士相象马馬傌车車俥炮砲包兵卒]?[一二三四五六七八九1-9１-９]?[进進退平][一二三四五六七八九1-9１-９]$/
export const ICCS_RE = /^[a-i][0-9]-?[a-i][0-9]$/i

export function looksLikeMove(text) {
  const t = String(text).replace(/\s+/g, "")
  return (CHINESE_MOVE_RE.test(t) && t.length >= 4) || ICCS_RE.test(t)
}

function normalize(text) {
  let out = ""
  for (const ch of String(text).replace(/\s+/g, "")) out += CHAR_MAP[ch] ?? ch
  return out
}

const fileNum = (c, side) => (side === RED ? 9 - c : c + 1)
const fileCol = (n, side) => (side === RED ? 9 - n : n - 1)
const numStr = (n, side) => (side === RED ? CN_NUM[n] : String(n))
const isStraight = type => type === KING || type === ROOK || type === CANNON || type === PAWN

/** 同一纵线上同类棋子，按“前→后”排序（前 = 更靠近对方） */
function sameFile(pos, sq) {
  const p = pos.board[sq]
  const side = p > 0 ? RED : -RED
  const c = colOf(sq)
  const list = []
  for (let r = 0; r < 10; r++) if (pos.board[sqOf(r, c)] === p) list.push(sqOf(r, c))
  return side === RED ? list : list.reverse()
}

function positionWords(n) {
  if (n === 2) return [["f"], ["b"]]
  if (n === 3) return [["f", "1"], ["m", "2"], ["b", "3"]]
  return Array.from({ length: n }, (_, i) => [String(i + 1), ...(i === 0 ? ["f"] : i === n - 1 ? ["b"] : [])])
}

function positionLabel(n, i) {
  if (n === 2) return ["前", "后"][i]
  if (n === 3) return ["前", "中", "后"][i]
  return CN_NUM[i + 1]
}

/** 有两条以上纵线各有 2 个以上兵卒 */
function multiPawnFiles(pos, p) {
  const count = Array(9).fill(0)
  for (let sq = 0; sq < 90; sq++) if (pos.board[sq] === p) count[colOf(sq)]++
  return count.filter(n => n >= 2).length >= 2
}

function moveParts(pos, m) {
  const from = moveFrom(m)
  const to = moveTo(m)
  const p = pos.board[from]
  const side = p > 0 ? RED : -RED
  const type = Math.abs(p)
  const fr = rowOf(from)
  const tr = rowOf(to)
  const forward = side === RED ? tr < fr : tr > fr
  const action = tr === fr ? "=" : forward ? "+" : "-"
  const target = action === "=" || !isStraight(type) ? fileNum(colOf(to), side) : Math.abs(tr - fr)
  return { from, to, p, side, type, action, target, file: fileNum(colOf(from), side) }
}

/** 一步棋的所有可接受规范键 */
function moveKeys(pos, m) {
  const { from, type, action, target, file } = moveParts(pos, m)
  const piece = KEY_PIECE[type]
  const tail = action + target
  const keys = [piece + file + tail]
  const list = sameFile(pos, from)
  if (list.length > 1) {
    const words = positionWords(list.length)[list.indexOf(from)]
    for (const w of words) {
      keys.push(w + piece + tail, w + piece + file + tail)
      if (type === PAWN) keys.push(w + file + tail)
    }
  }
  return keys
}

/** 规范的中文记谱 */
export function moveToChinese(pos, m) {
  const { from, p, side, type, action, target, file } = moveParts(pos, m)
  const name = PIECE_NAME[side][type]
  const act = { "+": "进", "-": "退", "=": "平" }[action]
  const tail = act + numStr(target, side)
  const list = sameFile(pos, from)
  // 仕相同线时进退方向已能区分，按习惯仍写纵线
  if (list.length === 1 || type === ADVISOR || type === BISHOP) return name + numStr(file, side) + tail
  const label = positionLabel(list.length, list.indexOf(from))
  if (type === PAWN && multiPawnFiles(pos, p)) return label + numStr(file, side) + tail
  return label + name + tail
}

/**
 * 解析玩家输入的走法
 * @returns {{ move: number } | { error: string }}
 */
export function parseMove(pos, text, legal = pos.legalMoves()) {
  const raw = String(text).replace(/\s+/g, "")
  if (ICCS_RE.test(raw)) {
    const m = iccsToMove(raw)
    if (legal.includes(m)) return { move: m }
    return { error: explainIllegal(pos, moveFrom(m), moveTo(m)) }
  }

  const key = normalize(raw)
  const matches = new Set()
  for (const m of legal) if (moveKeys(pos, m).includes(key)) matches.add(m)
  if (matches.size === 1) return { move: [...matches][0] }
  if (matches.size > 1) return { error: "这条纵线上有多个同类棋子，请用“前/后”区分，例如：前车进一" }
  return { error: diagnose(pos, key) }
}

/** 找出玩家想走的那颗棋子，说明为什么不能走 */
function diagnose(pos, key) {
  const side = pos.side
  const m = /^([fmb1-5])?([KABNRCP])?([1-9])?([+\-=])([1-9])$/.exec(key)
  if (!m) return "看不懂这步棋，例：炮二平五、马8进7、h2e2"
  const [, word, pieceKey, fileStr, action, targetStr] = m
  const type = KEY_PIECE.indexOf(pieceKey ?? "P")
  if (!pieceKey && !word) return "看不懂这步棋，例：炮二平五、马8进7、h2e2"
  const name = PIECE_NAME[side][type]
  let candidates = []
  for (let sq = 0; sq < 90; sq++) if (pos.board[sq] === side * type) candidates.push(sq)
  if (!candidates.length) return `你已经没有${name}了`
  if (fileStr) {
    const file = Number(fileStr)
    candidates = candidates.filter(sq => fileNum(colOf(sq), side) === file)
    if (!candidates.length) return `你的第${numStr(file, side)}路没有${name}`
  }
  if (word) {
    const groups = new Map()
    for (const sq of candidates) groups.set(colOf(sq), sameFile(pos, sq))
    const picked = []
    for (const list of groups.values()) {
      if (list.length < 2) continue
      const words = positionWords(list.length)
      list.forEach((sq, i) => { if (words[i].includes(word)) picked.push(sq) })
    }
    if (!picked.length) return `没有找到对应的${name}，“前/后”只用于同一纵线上有两个${name}的时候`
    candidates = picked
  }
  const target = Number(targetStr)
  for (const from of candidates) {
    const fr = rowOf(from)
    const fc = colOf(from)
    const dir = side === RED ? -1 : 1
    let to = -1
    if (action === "=") {
      to = sqOf(fr, fileCol(target, side))
    } else {
      const sign = action === "+" ? dir : -dir
      if (isStraight(type)) {
        to = sqOf(fr + sign * target, fc)
        if (fr + sign * target < 0 || fr + sign * target > 9) return "走出棋盘了"
      } else {
        const tc = fileCol(target, side)
        const dc = Math.abs(tc - fc)
        const dr = type === KNIGHT ? (dc === 1 ? 2 : dc === 2 ? 1 : 0) : type === BISHOP ? 2 : 1
        if (!dr || (type !== KNIGHT && dc !== dr)) return `${name}不能这样走`
        const tr = fr + sign * dr
        if (tr < 0 || tr > 9) return "走出棋盘了"
        to = sqOf(tr, tc)
      }
    }
    if (to >= 0 && candidates.length === 1) return explainIllegal(pos, from, to)
  }
  return `这步${name}不能这样走`
}

/** 列出若干合法走法作为提示 */
export function sampleMoves(pos, n = 5) {
  const legal = pos.legalMoves()
  return legal.slice(0, n).map(m => moveToChinese(pos, m))
}

export { moveToIccs }
