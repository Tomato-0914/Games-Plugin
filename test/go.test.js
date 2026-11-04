import { test } from "node:test"
import assert from "node:assert/strict"
import { GoGame, parsePoint, pointName, starPoints, formatZi, PASS, YIELD, BLACK, WHITE } from "../games/go/Board.js"

const P = (s, size = 9) => parsePoint(s, size)
/** 交替落子：坐标列表，"pass" 为停一手 */
function play(g, list) {
  for (const s of list) {
    const r = s === "pass" ? g.pass() : s === "yield" ? g.yieldTurn() : g.play(P(s, g.size))
    if (r.error) throw new Error(`${s}: ${r.error}`)
  }
  return g
}

test("坐标：列字母跳过 I", () => {
  assert.equal(pointName(P("J1"), 9), "J1")
  assert.equal(P("I1"), -1)
  assert.equal(P("A1"), 8 * 9)
  assert.equal(pointName(P("T19", 19), 19), "T19")
  assert.equal(P("K1"), -1) // 9 路只有 A–J
  assert.equal(P("4D"), P("d4"))
  assert.deepEqual(starPoints(9).map(i => pointName(i, 9)).sort(), ["C3", "C7", "E5", "G3", "G7"])
  assert.equal(starPoints(19).length, 9)
})

test("提子：单子、边角、多子", () => {
  // 黑 E5 被白四面包围
  const g = play(new GoGame(), ["E5", "E6", "A1", "D5", "A3", "F5", "B9"])
  const r = g.play(P("E4"))
  assert.deepEqual(r.captured.map(i => pointName(i, 9)), ["E5"])
  assert.equal(g.captures[WHITE], 1)
  // 角上：黑 A1 被白 A2 B1 提
  const h = play(new GoGame(), ["A1", "A2", "J9"])
  assert.equal(h.play(P("B1")).captured.length, 1)
  // 两子：黑 A1 B1，白 A2 B2 C1
  const k = play(new GoGame(), ["A1", "A2", "B1", "B2", "J9"])
  assert.equal(k.play(P("C1")).captured.length, 2)
})

test("禁着点：不能自杀；能提子时不算自杀", () => {
  // 白 A2 B1 围住 A1，黑下 A1 是自杀
  const g = play(new GoGame(), ["J9", "A2", "J8", "B1"])
  assert.match(g.play(P("A1")).error, /禁着点/)
  // 黑 B2 C1 包围白 B1（白 B1 只剩 A1 一口气），黑下 A1 能提掉 B1，合法
  const h = play(new GoGame(), ["B2", "B1", "C1", "A2", "A3", "J9"])
  const r = h.play(P("A1"))
  assert.ok(r.ok, r.error)
  assert.ok(r.captured.map(i => pointName(i, 9)).includes("B1"))
})

test("打劫（明确局面）", () => {
  const g = new GoGame()
  // 黑：C4 B5 C6；白：D4 E5 D6 C5。白 C5 只剩 D5 一口气
  play(g, ["C4", "D4", "B5", "E5", "C6", "D6", "J9", "C5"])
  // 黑 D5 提白 C5（D5 被白 D4 E5 D6 围，提子后有 C5 一口气）
  const r = g.play(P("D5"))
  assert.deepEqual(r.captured.map(i => pointName(i, 9)), ["C5"])
  // 白立即在 C5 提回黑 D5：全局同形，禁止
  assert.match(g.play(P("C5")).error, /局面相同/)
  // 白在别处下一手（找劫材），黑应一手，白再提回就可以
  play(g, ["J1", "H1"])
  assert.ok(g.play(P("C5")).ok)
})

test("停一手：双方连续停一手", () => {
  const g = play(new GoGame(), ["E5", "pass"])
  assert.equal(g.bothPassed, false)
  g.pass()
  assert.equal(g.bothPassed, true)
})

test("让子：只有白方、白方落子前、连续、最多 5 次；贴还让子数的一半", () => {
  const g = new GoGame()
  assert.match(g.yieldTurn().error, /只有白方/)
  play(g, ["C3", "yield", "G7", "yield", "C7"])
  assert.equal(g.handicap, 3)
  assert.equal(g.komi, 3) // 贴还 1又1/2 子 = 3 目
  play(g, ["E5"]) // 白方落子
  play(g, ["G3"])
  assert.match(g.yieldTurn().error, /不能再让子/)

  const h = new GoGame()
  for (let k = 0; k < 5; k++) play(h, [["C3", "G7", "C7", "G3", "E5"][k], "yield"])
  assert.equal(h.handicap, 6)
  play(h, ["D4"])
  assert.match(h.yieldTurn().error, /最多让 5 子/)
  // 没有让子时贴 7.5 目
  assert.equal(new GoGame().komi, 7.5)
})

test("数子：活子 + 地，贴 3又3/4 子", () => {
  // 9 路列为 A B C D E F G H J（没有 I）。黑占 D 列，白占 F 列，E 列为中立
  const g = new GoGame()
  const moves = []
  for (let r = 1; r <= 9; r++) moves.push(`D${r}`, `F${r}`)
  play(g, moves)
  const s = g.score()
  // 黑：D 列 9 子 + A–C 列 27 点 = 36；白：F 列 9 子 + G、H、J 列 27 点 = 36
  assert.equal(s.black, 36)
  assert.equal(s.white, 36)
  assert.equal(s.diff, -7.5)
  assert.equal(s.winner, WHITE)
  // 黑子打入白地：不认定为死子时，白地被破坏，只剩 F 列活子
  const h = new GoGame({ moves: g.moves })
  play(h, ["H5", "pass"])
  assert.equal(h.score().white, 9)
  // 认定 H5 为死子后，白地恢复，H5 也算白方的
  const d = h.score([P("H5")])
  assert.equal(d.white, 36)
  assert.equal(d.black, 36)
})

test("悔棋、存档", () => {
  const g = play(new GoGame(), ["E5", "E6", "D5", "pass"])
  g.undo(2)
  assert.equal(g.moveCount, 2)
  assert.equal(g.side, BLACK)
  const g2 = GoGame.fromJSON(JSON.parse(JSON.stringify(g.toJSON())))
  assert.deepEqual([...g2.cells], [...g.cells])
  assert.deepEqual(g2.moves, g.moves)
  assert.equal(formatZi(7.5), "3又3/4 子")
  assert.equal(formatZi(1.5), "3/4 子")
  assert.equal(formatZi(4), "2 子")
  assert.equal(formatZi(2.5), "1又1/4 子")
})
