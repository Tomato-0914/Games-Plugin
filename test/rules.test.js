import { test } from "node:test"
import assert from "node:assert/strict"
import { Position, START_FEN, iccsToMove, moveToIccs } from "../games/xiangqi/Board.js"
import { XiangqiGame } from "../games/xiangqi/Game.js"
import { BOOK } from "../games/xiangqi/Book.js"

function perft(pos, d) {
  if (d === 0) return 1
  let n = 0
  const side = pos.side
  for (const m of pos.genMoves()) {
    pos.makeMove(m)
    if (!pos.inCheck(side)) n += perft(pos, d - 1)
    pos.unmakeMove()
  }
  return n
}

test("初始局面 perft 1-3 与公认值一致", () => {
  const pos = Position.fromFen()
  assert.equal(perft(pos, 1), 44)
  assert.equal(perft(pos, 2), 1920)
  assert.equal(perft(pos, 3), 79666)
  assert.equal(pos.toFen(), START_FEN)
})

test("FEN 读写往返一致", () => {
  const fen = "r1bakab1r/9/1cn4c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C1N2/9/RNBAKAB1R b"
  assert.equal(Position.fromFen(fen).toFen(), fen)
})

const legal = (fen, iccs) => Position.fromFen(fen).legalMoves().map(moveToIccs).includes(iccs)

test("蹩马腿", () => {
  // 红马 b0，b1 有子挡住马腿，不能跳 a2/c2
  const fen = "3k5/9/9/9/9/9/9/9/1P7/1N2K4 w"
  assert.equal(legal(fen, "b0a2"), false)
  assert.equal(legal(fen, "b0c2"), false)
  assert.equal(legal(fen, "b0d1"), true)
})

test("塞象眼、象不过河", () => {
  const fen = "3k5/9/9/9/9/2B6/3P5/9/9/4K4 w"
  // 相 c4，d3 有兵塞眼，不能到 e2
  assert.equal(legal(fen, "c4e2"), false)
  assert.equal(legal(fen, "c4a2"), true)
  // 相不能过河到 e6
  assert.equal(legal(fen, "c4e6"), false)
  assert.equal(legal(fen, "c4a6"), false)
})

test("炮隔子吃、无炮架不能吃", () => {
  const fen = "3k5/9/9/9/9/9/p8/9/9/C3K4 w"
  assert.equal(legal(fen, "a0a3"), false) // 直接吃不行
  const fen2 = "3k5/9/9/9/p8/9/P8/9/9/C3K4 w"
  assert.equal(legal(fen2, "a0a5"), true) // 隔兵吃卒
})

test("将帅不能照面", () => {
  const fen = "3k5/9/9/9/9/9/9/9/9/4K4 w"
  assert.equal(legal(fen, "e0d0"), false)
  assert.equal(legal(fen, "e0f0"), true)
})

test("兵过河才能横走", () => {
  const fen = "3k5/9/9/9/9/9/4P4/9/9/5K3 w"
  assert.equal(legal(fen, "e3d3"), false)
  const fen2 = "3k5/9/9/9/4P4/9/9/9/9/5K3 w"
  assert.equal(legal(fen2, "e5d5"), true)
  assert.equal(legal(fen2, "e5e4"), false)
})

test("将死判负", () => {
  // 双车错杀：a8 车封 8 线，b 车沉底
  const g = new XiangqiGame({ fen: "3k5/R8/9/9/9/9/9/9/9/1R2K4 w" })
  g.play(iccsToMove("b0b9"))
  assert.deepEqual(g.result, { winner: 1, reason: "checkmate" })
})

test("困毙判负", () => {
  // 黑将 d9 没被将军，但 d8、e9 都被红兵 e8 控制，无子可走
  const g = new XiangqiGame({ fen: "3k5/4P4/9/9/9/9/9/9/9/5K3 b" })
  assert.equal(g.pos.inCheck(), false)
  assert.deepEqual(g.result, { winner: 1, reason: "stalemate" })
})

test("长将判负", () => {
  // 红车反复将军，黑将来回躲
  const g = new XiangqiGame({ fen: "3k5/9/9/9/9/9/9/9/9/4K3R w", naturalLimit: 0 })
  const seq = ["i0i9", "d9d8", "i9i8", "d8d9", "i8i9", "d9d8", "i9i8", "d8d9", "i8i9"]
  for (const m of seq) {
    if (g.result) break
    g.play(iccsToMove(m))
  }
  assert.equal(g.result?.reason, "perpetual")
  assert.equal(g.result.winner, -1)
})

test("悔棋恢复局面", () => {
  const g = new XiangqiGame()
  g.play(iccsToMove("h2e2"))
  g.play(iccsToMove("h9g7"))
  g.undo(2)
  assert.equal(g.pos.toFen(), START_FEN)
  assert.equal(g.records.length, 0)
})

test("存档恢复", () => {
  const g = new XiangqiGame()
  for (const m of ["h2e2", "h9g7", "h0g2"]) g.play(iccsToMove(m))
  const g2 = XiangqiGame.fromJSON(JSON.parse(JSON.stringify(g.toJSON())))
  assert.equal(g2.pos.toFen(), g.pos.toFen())
  assert.equal(g2.records[0].cn, "炮二平五")
})

test("开局库走法全部合法", () => {
  for (const [hist, list] of Object.entries(BOOK)) {
    const g = new XiangqiGame({ moves: hist ? hist.split(" ") : [] })
    const legalSet = new Set(g.legalMoves().map(moveToIccs))
    for (const [m] of list) assert.ok(legalSet.has(m), `${hist} -> ${m}`)
  }
})
