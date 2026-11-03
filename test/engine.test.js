import { test } from "node:test"
import assert from "node:assert/strict"
import { think } from "../games/xiangqi/Engine.js"
import { XiangqiGame } from "../games/xiangqi/Game.js"
import { iccsToMove, START_FEN } from "../games/xiangqi/Board.js"

test("AI 能找到一步杀", () => {
  // 红车 b0 沉底 b9 即绝杀（另一车 a8 控制 8 线，帅控制 e 线）
  const fen = "3k5/R8/9/9/9/9/9/9/9/1R2K4 w"
  for (const level of ["简单", "普通"]) {
    const res = think({ fen, level })
    const g = new XiangqiGame({ fen })
    g.play(iccsToMove(res.iccs))
    // 象棋中困毙同样判胜
    assert.equal(g.result?.winner, 1, `${level}: ${res.iccs}`)
  }
})

test("AI 会吃掉送到嘴边的车", () => {
  // 红车 a0 可以吃黑车 a4；黑将不在 d 线，没有更快的杀棋
  const fen = "4k4/9/9/9/9/r8/9/9/9/R2K5 w"
  const res = think({ fen, level: "简单" })
  assert.equal(res.iccs, "a0a4")
})

test("普通难度单步在时限内", () => {
  const t = Date.now()
  const res = think({ fen: START_FEN, moves: ["h2e2", "h9g7", "h0g2", "i9h9", "i0h0", "b9c7", "g3g4", "g6g5"], level: "普通" })
  assert.ok(res.iccs)
  assert.ok(Date.now() - t < 2500, `用时 ${Date.now() - t}ms`)
})
