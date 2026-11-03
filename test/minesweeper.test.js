import { test } from "node:test"
import assert from "node:assert/strict"
import { Minefield, LEVELS, layMines, rng, neighbors } from "../games/minesweeper/Board.js"
import { deduce, generate, solvable } from "../games/minesweeper/Solver.js"
import { parseOps, looksLikeOps, cellName } from "../games/minesweeper/Notation.js"

test("首次翻开保护：首格和周围 8 格没有雷", () => {
  const r = rng(7)
  for (let k = 0; k < 200; k++) {
    const first = Math.floor(r() * 81)
    const list = layMines(9, 9, 10, first, r)
    assert.equal(list.length, 10)
    for (const i of [first, ...neighbors(9, 9)[first]]) assert.ok(!list.includes(i))
  }
})

test("连锁展开、快速翻开、胜负", () => {
  // 3×3，只有右下角一颗雷
  const f = new Minefield({ rows: 3, cols: 3, mines: 1, mineList: [8] })
  const res = f.reveal(0)
  // 0 连锁展开：除了雷和它周围的数字以外都打开
  assert.equal(res.opened.length, 8)
  assert.equal(f.status, "won")
  assert.equal(f.flag[8], 1)

  const g = new Minefield({ rows: 3, cols: 3, mines: 1, mineList: [8] })
  g.reveal(4) // 中间的 1
  assert.equal(g.chord(4).note, "flags")
  g.toggleFlag(8)
  const c = g.chord(4)
  assert.equal(c.opened.length > 0, true)
  assert.equal(g.status, "won")

  const h = new Minefield({ rows: 3, cols: 3, mines: 1, mineList: [8] })
  h.reveal(4)
  h.toggleFlag(7) // 插错旗
  const boom = h.chord(4)
  assert.equal(boom.exploded, 8)
  assert.equal(h.status, "lost")
})

test("插旗的格子不会被翻开", () => {
  const f = new Minefield({ rows: 3, cols: 3, mines: 1, mineList: [8] })
  f.toggleFlag(0)
  assert.equal(f.reveal(0).note, "flagged")
  assert.equal(f.open[0], 0)
})

test("自动翻开：旗数等于数字时连续展开", () => {
  // 1 行 5 列：雷在 2 号格
  const f = new Minefield({ rows: 1, cols: 5, mines: 1, mineList: [2] })
  f.reveal(1)
  f.reveal(3)
  f.toggleFlag(2)
  const res = f.autoChord()
  assert.deepEqual(res.opened.sort(), [0, 4])
  assert.equal(f.status, "won")
})

test("求解器只推出正确结论", () => {
  const r = rng(3)
  for (const { rows, cols, mines } of Object.values(LEVELS)) {
    for (let k = 0; k < 30; k++) {
      const first = Math.floor(r() * rows * cols)
      const f = new Minefield({ rows, cols, mines, mineList: layMines(rows, cols, mines, first, r) })
      f.floodOpen(first)
      for (let step = 0; step < 50; step++) {
        const { safe, mines: known } = deduce(f)
        for (const i of safe) assert.equal(f.mine[i], 0, "推成安全的格子是雷")
        for (let i = 0; i < f.total; i++) if (known[i]) assert.equal(f.mine[i], 1, "推成雷的格子不是雷")
        if (!safe.length) break
        for (const i of safe) f.floodOpen(i)
      }
    }
  }
})

test("无猜生成：三档难度都能只靠推理扫完", () => {
  for (const [name, { rows, cols, mines }] of Object.entries(LEVELS)) {
    for (let k = 0; k < 5; k++) {
      const first = Math.floor(rows / 2) * cols + k
      const g = generate({ rows, cols, mines, first, seed: 100 + k })
      assert.ok(g.noGuess, `${name} 生成失败`)
      assert.ok(solvable(rows, cols, mines, g.mineList, first), name)
      assert.ok(g.time < 1000, `${name} 用时 ${g.time}ms`)
    }
  }
})

test("存档往返", () => {
  const f = new Minefield({ rows: 9, cols: 9, mines: 10, mineList: layMines(9, 9, 10, 40, rng(1)) })
  f.reveal(40)
  f.toggleFlag(0)
  const g = Minefield.fromJSON(JSON.parse(JSON.stringify(f.toJSON())))
  assert.deepEqual(g.toJSON(), f.toJSON())
  assert.equal(g.openCount, f.openCount)
})

test("坐标解析", () => {
  assert.deepEqual(parseOps("C5", 9, 9), { flag: false, cells: [2 * 9 + 4] })
  assert.deepEqual(parseOps("c1c2c3", 9, 9), { flag: false, cells: [18, 19, 20] })
  assert.deepEqual(parseOps("旗C5 D6", 9, 9), { flag: true, cells: [22, 32] })
  assert.deepEqual(parseOps("!a1,b2", 9, 9), { flag: true, cells: [0, 10] })
  assert.deepEqual(parseOps("P30", 16, 30), { flag: false, cells: [15 * 30 + 29] })
  assert.deepEqual(parseOps("a12b3", 16, 30), { flag: false, cells: [11, 32] })
  assert.match(parseOps("J1", 9, 9).error, /A–I/)
  assert.match(parseOps("A10", 9, 9).error, /1–9/)
  assert.equal(cellName(15 * 30 + 29, 30), "P30")
  assert.deepEqual(parseOps("开C5", 9, 9), { flag: false, cells: [22] })
  assert.deepEqual(parseOps("翻开 c1c2", 9, 9), { flag: false, cells: [18, 19] })
  for (const t of ["C5", "c1c2c3", "旗C5", "!a1 b2", "a1, b2", "开C5", "翻开 c1"]) assert.ok(looksLikeOps(t), t)
  for (const t of ["你好", "C", "5", "#扫雷", "炮二平五", "abc"]) assert.ok(!looksLikeOps(t), t)
})
