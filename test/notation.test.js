import { test } from "node:test"
import assert from "node:assert/strict"
import { Position, iccsToMove, moveToIccs } from "../games/xiangqi/Board.js"
import { moveToChinese, parseMove, looksLikeMove } from "../games/xiangqi/Notation.js"

const cn = (fen, iccs) => moveToChinese(Position.fromFen(fen), iccsToMove(iccs))
const parse = (fen, text) => {
  const res = parseMove(Position.fromFen(fen), text)
  return res.move !== undefined ? moveToIccs(res.move) : res.error
}

test("开局常见走法的中文记谱", () => {
  const start = undefined
  assert.equal(cn(start, "h2e2"), "炮二平五")
  assert.equal(cn(start, "h0g2"), "马二进三")
  assert.equal(cn(start, "i0i1"), "车一进一")
  assert.equal(cn(start, "c3c4"), "兵七进一")
  assert.equal(cn(start, "c0e2"), "相七进五")
  assert.equal(cn(start, "f0e1"), "仕四进五")
  const black = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b"
  assert.equal(cn(black, "h9g7"), "马8进7")
  assert.equal(cn(black, "b7e7"), "炮2平5")
  assert.equal(cn(black, "a9a8"), "车1进1")
  assert.equal(cn(black, "e9e8"), "将5进1")
})

test("解析各种写法", () => {
  assert.equal(parse(undefined, "炮二平五"), "h2e2")
  assert.equal(parse(undefined, "炮2平5"), "h2e2")
  assert.equal(parse(undefined, "砲二平五"), "h2e2")
  assert.equal(parse(undefined, "傌二進三"), "h0g2")
  assert.equal(parse(undefined, "h2e2"), "h2e2")
  assert.equal(parse(undefined, "H2-E2"), "h2e2")
  const black = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b"
  assert.equal(parse(black, "马8进7"), "h9g7")
  assert.equal(parse(black, "马八进七"), "h9g7")
  assert.equal(parse(black, "卒7进1"), "g6g5")
})

test("同一纵线两车用前后区分", () => {
  // 红车 e3、e1
  const fen = "3k5/9/9/9/9/9/4R4/9/4R4/5K3 w"
  assert.equal(cn(fen, "e3e4"), "前车进一")
  assert.equal(cn(fen, "e1e2"), "后车进一")
  assert.equal(parse(fen, "前车进一"), "e3e4")
  assert.equal(parse(fen, "后车平四"), "e1f1")
  assert.match(parse(fen, "车五平四"), /前\/后/)
})

test("非法走法给出原因", () => {
  assert.match(parse(undefined, "马二进四"), /马腿|日字|不能/)
  assert.match(parse(undefined, "炮二进九"), /炮|棋盘/)
  assert.match(parse(undefined, "车三进一"), /没有车/)
  assert.match(parse(undefined, "相三平五"), /相|田字|不能|自己/)
  assert.match(parse(undefined, "e0e1"), /./)
  assert.match(parse(undefined, "a9a8"), /对方/)
})

test("识别是否像走法", () => {
  for (const t of ["炮二平五", "马8进7", "前车进一", "h2e2", "h2-e2", "后兵平四"]) assert.ok(looksLikeMove(t), t)
  for (const t of ["你好", "炮二", "进一", "abc", "#象棋"]) assert.ok(!looksLikeMove(t), t)
})
