import { test } from "node:test"
import assert from "node:assert/strict"
import { FlyingGame, chooseMove } from "../games/flying/Game.js"
import { LOOP, START, HOME, loopIndex, loopColor, isOwnSquare, cellOf, FINISH } from "../games/flying/Board.js"

/** 按顺序返回给定点数的骰子 */
const diceOf = (...seq) => () => {
  if (!seq.length) throw new Error("骰子序列用完了")
  return seq.shift()
}

test("棋盘几何：52 格不重复，起点是自己颜色，终点通道入口相邻", () => {
  assert.equal(LOOP.length, 52)
  assert.equal(new Set(LOOP.map(c => c.join())).size, 52)
  for (let c = 0; c < 4; c++) {
    assert.equal(loopColor(START[c]), c)
    // 第 50 格紧挨终点通道第一格
    const [x1, y1] = LOOP[loopIndex(c, 50)]
    const [x2, y2] = HOME[c][0]
    assert.equal(Math.abs(x1 - x2) + Math.abs(y1 - y2), 1, `颜色 ${c}`)
    // 自己颜色的格子每 4 格一个
    for (let p = 1; p <= 50; p++) assert.equal(isOwnSquare(p), loopColor(loopIndex(c, p)) === c)
    // 飞行捷径两端在同一行或同一列，相隔两格（中间是下一位玩家的终点通道末端）
    const [ax, ay] = cellOf(c, 5)
    const [bx, by] = cellOf(c, 17)
    const [mx, my] = HOME[(c + 1) % 4][4]
    assert.deepEqual([(ax + bx) / 2, (ay + by) / 2], [mx, my])
  }
})

test("起飞需要 6，掷出 6 可以再掷", () => {
  const g = new FlyingGame({ colors: [0, 2], dice: diceOf(3, 6, 2) })
  g.rollDice()
  assert.deepEqual(g.movablePlanes(), [])
  g.skip()
  assert.equal(g.color, 2)
  g.rollDice() // 蓝 6
  assert.deepEqual(g.distinctMoves(), [0])
  const r = g.move(0)
  assert.equal(r.takeoff, true)
  assert.equal(r.again, true)
  assert.equal(g.color, 2)
  g.rollDice() // 2
  g.move(0)
  assert.equal(g.pos[2][0], 2)
  assert.equal(g.color, 0)
})

test("连续三次 6 本回合作废", () => {
  const g = new FlyingGame({ colors: [0, 2], dice: diceOf(6, 6, 6) })
  g.rollDice(); g.move(0)
  g.rollDice(); g.move(0)
  const r = g.rollDice()
  assert.equal(r.voided, true)
  assert.equal(g.color, 2)
})

test("跳子 +4；落到飞行起点飞 12 格，之后还能跳一次", () => {
  const g = new FlyingGame({ colors: [0, 2], dice: diceOf(1) })
  g.pos[0][0] = 0 // 起飞点
  g.roll = 0
  g.rollDice() // 1 → 第 1 格（自己颜色）跳到 5（飞行起点）→ 飞到 17，不能再跳
  const info = g.move(0)
  assert.deepEqual(info.steps, ["jump", "fly"])
  assert.equal(g.pos[0][0], 17)

  const h = new FlyingGame({ colors: [0, 2], dice: diceOf(3) })
  h.pos[0][0] = 2
  h.rollDice() // 2+3 = 5 → 飞到 17 → 跳到 21
  const i2 = h.move(0)
  assert.deepEqual(i2.steps, ["fly", "jump"])
  assert.equal(h.pos[0][0], 21)
})

test("撞子：落点、跳子落点、飞棋横穿的终点通道格都会撞回", () => {
  // 红走到蓝所在的格子
  const g = new FlyingGame({ colors: [0, 2], dice: diceOf(2) })
  g.pos[0][0] = 10
  // 找到红第 12 格对应的外圈格，把蓝放到那里
  const idx = loopIndex(0, 12)
  const bluePos = ((idx - START[2] + 52) % 52) + 1
  g.pos[2][1] = bluePos
  g.pos[2][2] = bluePos // 蓝叠子也一起被撞回
  g.rollDice()
  const info = g.move(0)
  assert.equal(info.hits.length, 2)
  assert.deepEqual([g.pos[2][1], g.pos[2][2]], [-1, -1])

  // 飞棋横穿黄的终点通道末端（第 55 格）
  const h = new FlyingGame({ colors: [0, 1], dice: diceOf(5) })
  h.pos[0][0] = 0
  h.pos[1][3] = 55
  h.rollDice() // 0+5 = 5 → 飞
  const i2 = h.move(0)
  assert.ok(i2.flew)
  assert.equal(h.pos[1][3], -1)
})

test("自己的飞机可以叠在一起，不会互相撞", () => {
  const g = new FlyingGame({ colors: [0, 2], dice: diceOf(2) })
  g.pos[0][0] = 10
  g.pos[0][1] = 12
  g.rollDice()
  g.move(0)
  assert.deepEqual([g.pos[0][0], g.pos[0][1]], [12, 12])
})

test("终点必须正好，多出的往回退", () => {
  const g = new FlyingGame({ colors: [0, 2], dice: diceOf(5, 2) })
  g.pos[0] = [53, 56, 56, 56]
  g.rollDice() // 53+5 = 58 → 退到 54
  g.move(0)
  assert.equal(g.pos[0][0], 54)
  assert.equal(g.color, 2)
  g.pos[2] = [-1, -1, -1, -1]
  g.rollDice() // 蓝 2，没得走
  g.skip()
  g.dice = diceOf(2)
  g.rollDice() // 红 54+2 = 56
  const info = g.move(0)
  assert.equal(info.finish, true)
  assert.equal(info.rank, 1)
  // 两人局：第一名产生后只剩一人，对局结束，蓝为最后一名
  assert.deepEqual(g.result, { ranks: [0, 2] })
})

test("四人局排出 1、2、3 名，最后一名为输", () => {
  const g = new FlyingGame({ colors: [0, 1, 2, 3], dice: diceOf(1, 1, 1) })
  g.pos[0] = [55, 56, 56, 56]
  g.pos[1] = [55, 56, 56, 56]
  g.pos[2] = [55, 56, 56, 56]
  for (let k = 0; k < 3; k++) {
    g.rollDice()
    g.move(0)
  }
  assert.deepEqual(g.result, { ranks: [0, 1, 2, 3] })
})

test("机器人优先撞子", () => {
  const g = new FlyingGame({ colors: [0, 2], dice: diceOf(3) })
  g.pos[0][0] = 20
  g.pos[0][1] = 30
  const idx = loopIndex(0, 33)
  g.pos[2][0] = ((idx - START[2] + 52) % 52) + 1
  g.rollDice()
  assert.equal(chooseMove(g), 1)
})

test("存档往返；机器人对局能下完", () => {
  const g = new FlyingGame({ colors: [0, 1, 2, 3] })
  for (let k = 0; k < 20000 && !g.result; k++) {
    g.rollDice()
    if (!g.roll) continue
    const m = chooseMove(g)
    if (m < 0) g.skip()
    else g.move(m)
    if (k === 50) {
      const copy = FlyingGame.fromJSON(JSON.parse(JSON.stringify(g.toJSON())))
      assert.deepEqual(copy.toJSON(), g.toJSON())
    }
  }
  assert.ok(g.result, "应在有限步内结束")
  assert.equal(g.result.ranks.length, 4)
  assert.equal(new Set(g.result.ranks).size, 4)
  // 前三名四架飞机都到了终点
  for (const c of g.result.ranks.slice(0, 3)) assert.ok(g.pos[c].every(p => p === FINISH), `颜色 ${c}`)
})
