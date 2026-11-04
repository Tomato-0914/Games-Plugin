import { test } from "node:test"
import assert from "node:assert/strict"
import { think } from "../games/gomoku/AI.js"
import { GomokuGame, parsePoint, pointName } from "../games/gomoku/Board.js"

const P = parsePoint
/** 交替落子：给出黑、白各自的坐标 */
function moves(black, white) {
  const list = []
  for (let k = 0; k < Math.max(black.length, white.length); k++) {
    if (black[k]) list.push(P(black[k]))
    if (white[k]) list.push(P(white[k]))
  }
  return list
}

test("AI 能直接成五", () => {
  for (const level of ["简单", "普通", "困难"]) {
    const m = moves(["D8", "E8", "F8", "G8"], ["D9", "E9", "F9", "A1"])
    assert.ok(["C8", "H8"].includes(pointName(think({ moves: m, level }).move)), level)
  }
})

test("AI 会堵对方的四", () => {
  for (const level of ["简单", "普通", "困难"]) {
    // 白方连四（D9-G9），轮到黑：黑没有五，必须堵 C9 或 H9
    const m = moves(["D8", "E7", "A1", "B1", "O15"], ["D9", "E9", "F9", "G9"])
    const p = pointName(think({ moves: m, level }).move)
    assert.ok(["C9", "H9"].includes(p), `${level}: ${p}`)
  }
})

test("AI 执黑不下禁手", () => {
  // 黑：F8 G8 H6 H7；白随意。H8 是三三禁手，且是黑方很好的点
  const m = moves(["F8", "G8", "H6", "H7"], ["A1", "A3", "A5", "O15"])
  for (const level of ["普通", "困难"]) {
    const r = think({ moves: m, level })
    assert.notEqual(pointName(r.move), "H8", level)
    assert.ok(!new GomokuGame({ moves: m }).play(r.move).error, level)
  }
})

test("AI 对局：困难难度单步在时限内且不出非法着", () => {
  const g = new GomokuGame()
  let maxT = 0
  while (!g.result && g.moveCount < 80) {
    const r = think({ moves: g.moves, level: g.side === 1 ? "困难" : "普通" })
    maxT = Math.max(maxT, r.time)
    assert.ok(!g.play(r.move).error)
  }
  assert.ok(maxT < 5500, `最长 ${maxT}ms`)
})
