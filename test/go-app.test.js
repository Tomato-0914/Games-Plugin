import { test, before } from "node:test"
import assert from "node:assert/strict"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

let dispatch
const KEY = g => `Chess-Plugin:Go:room:group:${g}`
before(async () => {
  dispatch = makeDispatcher(await loadApps([
    new URL("../apps/Xiangqi/Xiangqi.js", import.meta.url).href,
    new URL("../apps/Gomoku/Gomoku.js", import.meta.url).href,
    new URL("../apps/Go/Go.js", import.meta.url).href,
    new URL("../apps/Minesweeper/Minesweeper.js", import.meta.url).href,
    new URL("../apps/System/GameHelp.js", import.meta.url).href,
  ]))
})

const A = { user: "111", nickname: "小明" }
const B = { user: "222", nickname: "小红" }
const say = (p, g, msg, extra = {}) => dispatch({ ...p, group: g, msg, ...extra })

/** 开一局：A 执黑，B 执白 */
async function start(g, size = 9) {
  await say(A, g, `#发起围棋 ${size} 黑`)
  return say(B, g, "#加入围棋")
}

test("帮助、登记；英文指令必须带 #", async () => {
  let r = await dispatch({ msg: "#围棋帮助" })
  assert.match(textOf(r.replies), /围棋[\s\S]*规则速览[\s\S]*打劫/)
  r = await dispatch({ msg: "#Go help" })
  assert.equal(r.handled, "help")
  r = await dispatch({ msg: "go" })
  assert.equal(r.handled, null)
  r = await dispatch({ msg: "#游戏帮助" })
  assert.match(textOf(r.replies), /围棋 棋类 · Go/)
})

test("开局：私聊不能下；默认 9 路；官方机器人先选大小", async () => {
  let r = await dispatch({ ...A, group: null, msg: "#发起围棋" })
  assert.match(textOf(r.replies), /请在群里发起/)
  r = await say(A, "300", "#发起围棋", { adapter: "QQBot" })
  assert.match(textOf(r.replies), /请选择棋盘大小\[按钮:9 路,13 路,19 路\]/)
  assert.ok(!kv.has(KEY("300")))
  r = await say(A, "300", "#发起围棋 7")
  assert.match(textOf(r.replies), /只能是 9、13 或 19 路/)
  r = await say(A, "300", "#发起围棋")
  assert.match(textOf(r.replies), /发起了一局 9 路围棋/)
  r = await say(B, "300", "#Go join")
  assert.match(textOf(r.replies), /9 路围棋开始！[\s\S]*黑贴 3又3\/4 子/)
  await say(A, "300", "#结束围棋", { isMaster: true })
})

test("落子、提子、禁着点、打劫、坐标检查", async () => {
  const g = "301"
  await start(g)
  let r = await say(B, g, "D4")
  assert.match(textOf(r.replies), /还没轮到你/)
  r = await say(A, g, "I5")
  assert.match(textOf(r.replies), /坐标超出棋盘：列 A–J（没有 I）/)
  // 劫形：黑 C4 B5 C6 / 白 D4 E5 D6 C5，然后黑 D5 提 C5
  for (const [p, m] of [[A, "C4"], [B, "D4"], [A, "B5"], [B, "E5"], [A, "C6"], [B, "D6"], [A, "J9"], [B, "C5"]]) {
    r = await say(p, g, m)
    assert.doesNotMatch(textOf(r.replies), /❌/, m)
  }
  r = await say(A, g, "D5")
  assert.match(textOf(r.replies), /黑方 小明：D5（提 1 子）/)
  r = await say(B, g, "C5")
  assert.match(textOf(r.replies), /会和之前的局面相同/)
  r = await say(B, g, "C4")
  assert.match(textOf(r.replies), /已经有子了/)
  // 白在角上自杀：白 A9? 先让黑占 B9 A8，白下 A9 为禁着点
  await say(B, g, "H1")
  await say(A, g, "B9")
  await say(B, g, "H2")
  await say(A, g, "A8")
  r = await say(B, g, "A9")
  assert.match(textOf(r.replies), /禁着点/)
  await say(A, g, "#结束围棋", { isMaster: true })
})

test("双方停一手 → 数子 → 双方同意结束", async () => {
  const g = "302"
  await start(g)
  for (let row = 1; row <= 9; row++) {
    await say(A, g, `D${row}`)
    await say(B, g, `F${row}`)
  }
  let r = await say(A, g, "#停一手")
  assert.match(textOf(r.replies), /黑方 小明：停一手/)
  r = await say(B, g, "pass")
  let t = textOf(r.replies)
  assert.match(t, /进入数子[\s\S]*估算结果：白胜 3又3\/4 子/)
  // 数子时不能落子
  r = await say(A, g, "E5")
  assert.match(textOf(r.replies), /正在数子/)
  r = await say(A, g, "#同意数子")
  assert.match(textOf(r.replies), /@222.*同意了数子结果/)
  r = await say(B, g, "#同意数子")
  t = textOf(r.replies)
  assert.match(t, /黑 36 子，白 36 子，黑贴 3又3\/4 子[\s\S]*白方 小红 胜 3又3\/4 子/)
  assert.ok(!kv.has(KEY(g)))
})

test("数子有异议可以继续对局", async () => {
  const g = "303"
  await start(g)
  await say(A, g, "E5")
  await say(B, g, "#停一手")
  await say(A, g, "#停一手")
  let r = await say(B, g, "#继续对局")
  assert.match(textOf(r.replies), /有异议，继续对局[\s\S]*轮到你落子（白方）/)
  r = await say(B, g, "D4")
  assert.match(textOf(r.replies), /白方 小红：D4/)
  await say(A, g, "#结束围棋", { isMaster: true })
})

test("让子：白方开局可以连续让子，落子后不能再让；按钮随之出现和消失", async () => {
  const g = "304"
  await say(A, g, "#发起围棋 9 黑", { adapter: "QQBot" })
  let r = await say(B, g, "#加入围棋", { adapter: "QQBot" })
  assert.doesNotMatch(textOf(r.replies), /让子\]/) // 黑方回合不显示让子
  r = await say(A, g, "C3", { adapter: "QQBot" })
  assert.match(textOf(r.replies), /\[按钮:落子,停一手,让子,悔棋,求和,认输\]/)
  r = await say(A, g, "#让子")
  assert.match(textOf(r.replies), /还没轮到你/)
  r = await say(B, g, "#让子")
  assert.match(textOf(r.replies), /白方 小红：让子（第 1 次），黑方继续落子（让 2 子，黑贴还 1 子）/)
  await say(A, g, "G7")
  await say(B, g, "#让子")
  await say(A, g, "C7")
  r = await say(B, g, "E5", { adapter: "QQBot" })
  assert.doesNotMatch(textOf(r.replies), /让子\]/)
  await say(A, g, "G3")
  r = await say(B, g, "#让子")
  assert.match(textOf(r.replies), /不能再让子/)
  await say(A, g, "#结束围棋", { isMaster: true })
})

test("悔棋、认输需要对方同意", async () => {
  const g = "305"
  await start(g)
  await say(A, g, "E5")
  let r = await say(A, g, "#悔棋")
  assert.match(textOf(r.replies), /@222.*请求悔棋/)
  r = await say(B, g, "#同意悔棋")
  assert.match(textOf(r.replies), /对方同意悔棋[\s\S]*@111/)
  r = await say(A, g, "#认输")
  assert.match(textOf(r.replies), /@222.*请求认输/)
  r = await say(B, g, "#同意认输")
  assert.match(textOf(r.replies), /白方 小红 获胜（认输）/)
})

test("同群同时下五子棋和围棋：坐标归各自的对局", async () => {
  const g = "306"
  await say(A, g, "#发起五子棋 黑")
  await say(B, g, "#加入五子棋")
  await say({ user: "333", nickname: "小刚" }, g, "#发起围棋 9 黑")
  await say({ user: "444", nickname: "小强" }, g, "#加入围棋")
  let r = await say(A, g, "H8")
  assert.match(textOf(r.replies), /黑方 小明：H8/)
  r = await say({ user: "333" }, g, "D4")
  assert.match(textOf(r.replies), /黑方 小刚：D4/)
  r = await say(B, g, "#认输")
  assert.match(textOf(r.replies), /@111.*请求认输/)
  await say(A, g, "#结束五子棋", { isMaster: true })
  await say(A, g, "#结束围棋", { isMaster: true })
})
