import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

let dispatch
const realRandom = Math.random
/** 让接下来的掷骰按给定点数出现，用完后恢复随机 */
function rig(...rolls) {
  Math.random = () => {
    if (!rolls.length) return realRandom()
    return (rolls.shift() - 1) / 6 + 0.01
  }
}
before(async () => {
  dispatch = makeDispatcher(await loadApps([
    new URL("../apps/FlyingChess/FlyingChess.js", import.meta.url).href,
    new URL("../apps/System/GameHelp.js", import.meta.url).href,
  ]))
})
after(() => { Math.random = realRandom })

const P = n => ({ user: String(n), nickname: `玩家${n}` })
const say = (p, g, msg, extra = {}) => dispatch({ ...p, group: g, msg, ...extra })
const KEY = g => `Chess-Plugin:FlyingChess:room:group:${g}`

test("帮助与登记", async () => {
  let r = await dispatch({ msg: "#飞行棋帮助" })
  assert.match(textOf(r.replies), /飞行棋[\s\S]*跳子[\s\S]*撞子/)
  r = await dispatch({ msg: "#游戏帮助" })
  assert.match(textOf(r.replies), /飞行棋 棋类 · FlyingChess/)
})

test("开房：加入、满员、只有发起人能开始、两人坐对角", async () => {
  const g = "100"
  let r = await say(P(1), g, "#发起飞行棋")
  assert.match(textOf(r.replies), /发起了一局飞行棋（1\/4）/)
  r = await say(P(1), g, "#开始飞行棋")
  assert.match(textOf(r.replies), /至少要 2 人/)
  r = await say(P(2), g, "#加入飞行棋")
  assert.match(textOf(r.replies), /（2\/4）/)
  r = await say(P(2), g, "#开始飞行棋")
  assert.match(textOf(r.replies), /只有发起人/)
  rig(3) // 红掷 3，没得走
  r = await say(P(1), g, "#开始飞行棋")
  let t = textOf(r.replies)
  assert.match(t, /飞行棋开始！红：玩家1，蓝：玩家2/)
  assert.match(t, /@1 轮到你（红）掷骰子/)
  // 不是自己的回合
  r = await say(P(2), g, "#掷骰子")
  assert.match(textOf(r.replies), /还没轮到你/)
  r = await say(P(1), g, "掷")
  t = textOf(r.replies)
  assert.match(t, /红 玩家1 掷出 3：没有可以走的飞机/)
  assert.match(t, /@2 轮到你（蓝）掷骰子/)
  await say(P(1), g, "#结束飞行棋")
  assert.ok(!kv.has(KEY(g)))
})

test("掷出 6 起飞并再掷；多架可走时选择飞机", async () => {
  const g = "101"
  await say(P(1), g, "#发起飞行棋")
  await say(P(2), g, "#加入飞行棋")
  await say(P(1), g, "#开始飞行棋")
  rig(6)
  let r = await say(P(1), g, "#掷骰子")
  assert.match(textOf(r.replies), /红 玩家1 掷出 6：1号起飞（掷出 6，再掷一次）[\s\S]*@1 轮到你（红）掷骰子/)
  rig(6)
  r = await say(P(1), g, "#掷骰子")
  assert.match(textOf(r.replies), /掷出 6，选择要走的飞机：1号 \/ 2号/)
  r = await say(P(1), g, "#掷骰子")
  assert.match(textOf(r.replies), /已经掷出 6，请选择飞机/)
  r = await say(P(1), g, "4")
  assert.equal(r.handled, "choose") // 4 号也在停机坪，等同 2 号
  assert.match(textOf(r.replies), /4号起飞/)
  // 1 号、4 号都在起飞点，走法相同：直接走，不用选
  rig(2)
  r = await say(P(1), g, "#掷骰子")
  assert.match(textOf(r.replies), /红 玩家1 掷出 2：1号前进[\s\S]*@2 轮到你（蓝）/)
  // 不是自己回合时发数字不处理
  r = await say(P(1), g, "2")
  assert.equal(r.handled, null)
  await say(P(1), g, "#结束飞行棋")
})

test("人机对战：机器人自动行动，能下完并排名；官方机器人按钮", async () => {
  const g = "102"
  let r = await say(P(1), g, "#人机飞行棋 1", { adapter: "QQBot" })
  assert.match(textOf(r.replies), /红：玩家1，蓝：柴郡·蓝/)
  assert.match(textOf(r.replies), /\[按钮:掷骰子\]/)
  let t = ""
  for (let k = 0; k < 3000 && !/最后一名/.test(t); k++) {
    r = await say(P(1), g, "#掷骰子", { adapter: "QQBot" })
    t = textOf(r.replies)
    if (/选择要走的飞机/.test(t)) {
      const btn = r.replies.flat().find(m => m?.type === "button")
      assert.ok(btn, "选择时应有按钮")
      r = await say(P(1), g, btn.data[0][0].callback, { adapter: "QQBot" })
      t = textOf(r.replies)
    }
  }
  assert.match(t, /🥇 第 1 名：[\s\S]*💔 最后一名：.*（输）/)
  assert.match(t, /\[按钮:飞行棋帮助,再来一局\]/)
  assert.ok(!kv.has(KEY(g)))
})

test("退出：交给机器人托管", async () => {
  const g = "103"
  for (const n of [1, 2, 3]) await say(P(n), g, n === 1 ? "#发起飞行棋" : "#加入飞行棋")
  rig(1)
  await say(P(1), g, "#开始飞行棋")
  rig(1, 1, 1, 1)
  const r = await say(P(2), g, "#退出飞行棋")
  assert.match(textOf(r.replies), /黄 玩家2 退出，飞机交给机器人托管/)
  await say(P(1), g, "#结束飞行棋")
})
