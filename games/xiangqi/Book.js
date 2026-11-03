/**
 * 小型开局库：常见开局的前几步，让 AI 开局有变化
 * 键为已走的 ICCS 走法（空格分隔），值为 [走法, 权重]
 */
import { START_FEN, iccsToMove } from "./Board.js"

const BOOK = {
  "": [["h2e2", 40], ["b2e2", 15], ["c3c4", 15], ["g3g4", 8], ["c0e2", 10], ["g0e2", 6], ["h0g2", 6]],
  // 中炮
  "h2e2": [["h9g7", 40], ["b9c7", 20], ["h7e7", 15], ["b7e7", 10], ["c6c5", 8]],
  "h2e2 h9g7": [["h0g2", 50], ["g3g4", 10]],
  "h2e2 h9g7 h0g2": [["i9h9", 50], ["b9c7", 20], ["g6g5", 10]],
  "h2e2 h9g7 h0g2 i9h9": [["i0h0", 50], ["b0c2", 15]],
  "h2e2 h9g7 h0g2 i9h9 i0h0": [["b9c7", 40], ["b7b3", 10], ["h7i7", 15]],
  "h2e2 h9g7 h0g2 i9h9 i0h0 b9c7": [["g3g4", 30], ["h0h6", 25], ["b0c2", 15]],
  "h2e2 h9g7 h0g2 b9c7": [["i0h0", 40], ["g3g4", 15]],
  "h2e2 b9c7": [["h0g2", 50], ["b0c2", 15]],
  "h2e2 b9c7 h0g2": [["h9g7", 40], ["a9b9", 15]],
  "h2e2 h7e7": [["h0g2", 40], ["b0c2", 20]],
  "h2e2 h7e7 h0g2": [["h9g7", 40], ["b9c7", 20]],
  "h2e2 b7e7": [["h0g2", 40], ["b0c2", 20]],
  "h2e2 c6c5": [["h0g2", 40], ["b0c2", 20]],
  // 左中炮
  "b2e2": [["b9c7", 35], ["h9g7", 25], ["b7e7", 15]],
  "b2e2 b9c7": [["b0c2", 50]],
  "b2e2 h9g7": [["b0c2", 50]],
  // 仙人指路
  "c3c4": [["g6g5", 30], ["g9e7", 20], ["b7e7", 15], ["h7e7", 15], ["c9e7", 10]],
  "c3c4 g6g5": [["b0c2", 30], ["h0g2", 20], ["b2e2", 15]],
  "c3c4 g9e7": [["h2e2", 30], ["b0c2", 25]],
  "c3c4 b7e7": [["h2e2", 20], ["b0c2", 25], ["c0e2", 15]],
  "c3c4 h7e7": [["b0c2", 30], ["h0g2", 20]],
  "c3c4 c9e7": [["b0c2", 30], ["h2e2", 20]],
  "g3g4": [["c6c5", 30], ["c9e7", 20], ["h7e7", 15]],
  // 飞相
  "c0e2": [["h7e7", 25], ["c6c5", 20], ["g6g5", 20], ["h9g7", 15], ["b9c7", 15]],
  "g0e2": [["b7e7", 25], ["g6g5", 20], ["c6c5", 20], ["b9c7", 15]],
  // 起马
  "h0g2": [["g6g5", 25], ["c6c5", 25], ["h9g7", 20], ["c9e7", 10]],
}

/** 查开局库，返回 ICCS 走法或 null */
export function bookMove(fen, moves, pos) {
  if (fen.split(" ")[0] !== START_FEN.split(" ")[0]) return null
  const list = BOOK[moves.join(" ")]
  if (!list) return null
  const legal = pos.legalMoves()
  const options = list.filter(([iccs]) => legal.includes(iccsToMove(iccs)))
  if (!options.length) return null
  let r = Math.random() * options.reduce((s, [, w]) => s + w, 0)
  for (const [iccs, w] of options) {
    if ((r -= w) <= 0) return iccs
  }
  return options[0][0]
}

export { BOOK }
