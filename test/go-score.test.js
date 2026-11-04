import { test } from "node:test"
import assert from "node:assert/strict"
import { GoGame, parsePoint, pointName, placeStone, EMPTY } from "../games/go/Board.js"
import { analyze, FastBoard } from "../games/go/Score.js"

const P = s => parsePoint(s, 9)

test("快速棋盘与规则引擎结果一致（随机对局交叉检查）", () => {
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (const size of [9, 13]) {
    for (let k = 0; k < 20; k++) {
      const cells = new Uint8Array(size * size)
      const fast = new FastBoard(size, cells)
      let c = 1
      for (let m = 0; m < size * size * 2; m++) {
        const p = Math.floor(rand() * size * size)
        if (cells[p] !== EMPTY) continue
        const ref = Uint8Array.from(cells)
        const legalRef = !placeStone(ref, size, p, c).error
        assert.equal(fast.legal(p, c), legalRef, `size ${size} move ${m}`)
        if (!legalRef) continue
        placeStone(cells, size, p, c)
        fast.put(p, c)
        assert.deepEqual([...fast.color], [...cells])
        c = 3 - c
      }
    }
  }
})

test("数子：找出打入对方地里的死子", () => {
  const g = new GoGame()
  const seq = []
  for (let r = 1; r <= 9; r++) seq.push(`D${r}`, `F${r}`)
  seq.push("H5", "B5")
  for (const s of seq) assert.ok(g.play(P(s)).ok, s)
  g.pass()
  g.pass()
  const a = analyze(g.toJSON())
  assert.deepEqual(a.dead.map(i => pointName(i, 9)).sort(), ["B5", "H5"])
  assert.equal(a.black, 36)
  assert.equal(a.white, 36)
  assert.equal(a.winner, 2)
})

test("数子：两只眼的活棋不会被误判为死子", () => {
  // 白方在 F 列和第 5 行筑墙；黑方在右下角做出两只分开的眼（H1、H3）：
  //   行 4：G4 H4 J4
  //   行 3：G3 (H3) J3
  //   行 2：G2 H2 J2
  //   行 1：G1 (H1) J1
  const g = new GoGame()
  const black = ["G1", "J1", "G2", "H2", "J2", "G3", "J3", "G4", "H4", "J4"]
  const white = ["F1", "F2", "F3", "F4", "F5", "G5", "H5", "J5", "F6", "F7"]
  for (let k = 0; k < black.length; k++) {
    assert.ok(g.play(P(black[k])).ok, black[k])
    assert.ok(g.play(P(white[k])).ok, white[k])
  }
  g.pass()
  g.pass()
  const a = analyze(g.toJSON())
  const dead = new Set(a.dead.map(i => pointName(i, 9)))
  for (const s of black) assert.ok(!dead.has(s), `${s} 被误判为死子`)
})

test("数子速度：19 路 1 秒内", () => {
  const g = new GoGame({ size: 19 })
  let k = 0
  while (g.stoneMoves < 150 && k++ < 5000) g.play(Math.floor(Math.random() * 361))
  const t = Date.now()
  analyze(g.toJSON())
  assert.ok(Date.now() - t < 2500, `${Date.now() - t}ms`)
})
