import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

const CONFIG = new URL("../config/config.yaml", import.meta.url)
const APP = new URL("../apps/FlyingChess/FlyingChess.js", import.meta.url).href
let backup = null
let dispatch
const wait = ms => new Promise(r => setTimeout(r, ms))

before(async () => {
  if (fs.existsSync(CONFIG)) backup = fs.readFileSync(CONFIG, "utf8")
  fs.writeFileSync(CONFIG, "flying:\n  actionTimeout: 1\n  hostAfter: 3\n")
  dispatch = makeDispatcher(await loadApps([APP]))
})
after(() => {
  if (backup === null) fs.unlinkSync(CONFIG)
  else fs.writeFileSync(CONFIG, backup)
})

test("超时由机器人代走，连续 3 次转托管，托管后整局自动下完", async () => {
  const start = await dispatch({ user: "1", group: "50", msg: "#人机飞行棋 1" })
  // 计时器的消息回复在最后一条消息下面
  await wait(4500)
  const t = textOf(start.replies)
  assert.match(t, /⌛ 红 用户1 超时，由机器人代走/)
  assert.match(t, /连续 3 次超时，已转为机器人托管/)
  assert.match(t, /最后一名/)
  assert.ok(!kv.has("Chess-Plugin:FlyingChess:room:group:50"))
})

test("托管中发指令可以接回", async () => {
  fs.writeFileSync(CONFIG, "flying:\n  actionTimeout: 1\n  hostAfter: 1\n")
  await dispatch({ user: "1", group: "51", msg: "#发起飞行棋" })
  await dispatch({ user: "2", group: "51", msg: "#加入飞行棋" })
  const s = await dispatch({ user: "1", group: "51", msg: "#开始飞行棋" })
  await wait(1300)
  assert.match(textOf(s.replies), /用户1 连续 1 次超时，已转为机器人托管/)
  // 托管后轮到用户2；用户1 发指令接回
  fs.writeFileSync(CONFIG, "flying:\n  actionTimeout: 60\n")
  const r = await dispatch({ user: "1", group: "51", msg: "#掷骰子" })
  assert.match(textOf(r.replies), /用户1 已接回操作/)
  await dispatch({ user: "1", group: "51", msg: "#结束飞行棋" })
})

test("重启后恢复", async () => {
  fs.writeFileSync(CONFIG, "flying:\n  actionTimeout: 60\n")
  await dispatch({ user: "1", group: "52", msg: "#发起飞行棋" })
  await dispatch({ user: "2", group: "52", msg: "#加入飞行棋" })
  await dispatch({ user: "1", group: "52", msg: "#开始飞行棋" })
  const fresh = makeDispatcher(await loadApps([`${APP}?restart=${Date.now()}`]))
  const r = await fresh({ user: "1", group: "52", msg: "#飞行棋棋盘" })
  assert.match(textOf(r.replies), /轮到你（红）掷骰子|选择要走的飞机/)
  const r2 = await fresh({ user: "1", group: "52", msg: "#掷骰子" })
  assert.match(textOf(r2.replies), /红 用户1 掷出 \d/)
  await fresh({ user: "1", group: "52", msg: "#结束飞行棋" })
})
