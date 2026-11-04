import { test } from "node:test"
import assert from "node:assert/strict"
import { GomokuGame, parsePoint, pointName, isForbiddenMove, SIZE, BLACK, WHITE } from "../games/gomoku/Board.js"

/** 按坐标摆子：black / white 为坐标列表 */
function board(black = [], white = []) {
  const cells = new Uint8Array(SIZE * SIZE)
  for (const p of black) cells[parsePoint(p)] = BLACK
  for (const p of white) cells[parsePoint(p)] = WHITE
  return cells
}
const forbidden = (b, w, at, rules) => isForbiddenMove(board(b, w), parsePoint(at), rules)

test("坐标解析", () => {
  assert.equal(pointName(parsePoint("H8")), "H8")
  assert.equal(parsePoint("h8"), parsePoint("8H"))
  assert.equal(pointName(parsePoint("A1")), "A1")
  assert.equal(pointName(parsePoint("O15")), "O15")
  assert.equal(parsePoint("P1"), -1)
  assert.equal(parsePoint("A16"), -1)
  assert.equal(parsePoint("A0"), -1)
  // A1 在左下角
  assert.equal(parsePoint("A1"), 14 * 15)
})

test("三三禁手", () => {
  assert.equal(forbidden(["F8", "G8", "H6", "H7"], [], "H8"), "三三")
  // 斜线 + 横线
  assert.equal(forbidden(["F6", "G7", "I8", "J8"], [], "H8"), "三三")
  // 跳三也算活三：F8 _ H8 I8 → F8 G8? 这里 F8 . H8 I8 形成跳活三
  assert.equal(forbidden(["F8", "I8", "H6", "H7"], [], "H8"), "三三")
})

test("一边被堵的三不是活三，不构成三三", () => {
  assert.equal(forbidden(["F8", "G8", "H6", "H7"], ["E8"], "H8"), "")
  assert.equal(forbidden(["F8", "G8", "H6", "H7"], ["H5"], "H8"), "")
})

test("四四禁手（两条线、同一条线）", () => {
  assert.equal(forbidden(["E8", "F8", "G8", "H5", "H6", "H7"], [], "H8"), "四四")
  // 同一条线上的两个四：D . F G H . J，下在 G8
  assert.equal(forbidden(["D8", "F8", "H8", "J8"], [], "G8"), "四四")
  // 冲四 + 冲四（一端被堵）也算
  assert.equal(forbidden(["E8", "F8", "G8", "H5", "H6", "H7"], ["D8", "H4"], "H8"), "四四")
})

test("四三不是禁手，活四不是禁手", () => {
  assert.equal(forbidden(["E8", "F8", "G8", "H6", "H7"], [], "H8"), "")
  assert.equal(forbidden(["E8", "F8", "G8"], [], "H8"), "")
})

test("成五优先于禁手", () => {
  // H8 同时成五和三三
  assert.equal(forbidden(["D8", "E8", "F8", "G8", "H6", "H7", "I9", "J10"], [], "H8"), "")
})

test("长连：默认算赢，可配置为禁手", () => {
  const g = new GomokuGame({ moves: [] })
  for (const [b, w] of [["C8", "C1"], ["D8", "D1"], ["E8", "E1"], ["G8", "G1"], ["H8", "H1"]]) {
    g.play(parsePoint(b))
    g.play(parsePoint(w))
  }
  // 黑下 F8 成六连
  assert.deepEqual(g.play(parsePoint("F8")), { ok: true })
  assert.deepEqual(g.result, { winner: BLACK, reason: "five" })
  assert.equal(forbidden(["C8", "D8", "E8", "G8", "H8"], [], "F8", { overline: "forbidden" }), "长连")
})

test("白棋没有禁手", () => {
  // 白方摆出三三也可以下
  const g = new GomokuGame()
  const seq = ["A1", "F8", "A3", "G8", "A5", "H6", "A7", "H7", "A9", "H8"]
  for (const p of seq) assert.ok(g.play(parsePoint(p)).ok, p)
})

test("对局：禁手拒绝、五连判胜、悔棋、存档", () => {
  const g = new GomokuGame()
  const seq = ["F8", "A1", "G8", "A2", "H6", "A3", "H7", "B1"]
  for (const p of seq) g.play(parsePoint(p))
  const r = g.play(parsePoint("H8"))
  assert.match(r.error, /禁手（三三）/)
  assert.equal(g.moveCount, 8)
  // 可以显示禁手点
  assert.ok(g.forbiddenPoints().includes(parsePoint("H8")))
  g.play(parsePoint("I8"))
  g.play(parsePoint("B2"))
  g.play(parsePoint("J8"))
  g.play(parsePoint("B3"))
  // F G _ I J：下 H8 成五（同时有三三，五连优先）
  assert.ok(g.play(parsePoint("H8")).ok)
  assert.deepEqual(g.result, { winner: BLACK, reason: "five" })
  assert.equal(g.winningLine().length, 5)
  g.undo(1)
  assert.equal(g.result, null)
  const g2 = GomokuGame.fromJSON(JSON.parse(JSON.stringify(g.toJSON())))
  assert.deepEqual([...g2.cells], [...g.cells])
  assert.equal(g2.side, g.side)
})

test("禁手判负模式", () => {
  const g = new GomokuGame({ rules: { forbiddenLoses: true } })
  for (const p of ["F8", "A1", "G8", "A2", "H6", "A3", "H7", "B1"]) g.play(parsePoint(p))
  g.play(parsePoint("H8"))
  assert.deepEqual(g.result, { winner: WHITE, reason: "forbidden", detail: "三三" })
})
