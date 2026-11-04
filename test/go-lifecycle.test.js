import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

const CONFIG = new URL("../config/config.yaml", import.meta.url)
const APP = new URL("../apps/Go/Go.js", import.meta.url).href
let backup = null
let dispatch
const wait = ms => new Promise(r => setTimeout(r, ms))

before(async () => {
  if (fs.existsSync(CONFIG)) backup = fs.readFileSync(CONFIG, "utf8")
  fs.writeFileSync(CONFIG, "go:\n  moveTimeout: 2\n  moveWarnBefore: 1\n  scoreTimeout: 1\n")
  dispatch = makeDispatcher(await loadApps([APP]))
})
after(() => {
  if (backup === null) fs.unlinkSync(CONFIG)
  else fs.writeFileSync(CONFIG, backup)
})

test("超时前提醒，超时判负", async () => {
  await dispatch({ user: "1", group: "200", msg: "#发起围棋 9 黑" })
  const join = await dispatch({ user: "2", group: "200", msg: "#加入围棋" })
  const n = join.replies.length
  await wait(2600)
  const t = textOf(join.replies.slice(n))
  assert.match(t, /@1 ⏰ 还剩 1 秒/)
  assert.match(t, /黑方 用户1 超时未落子[\s\S]*白方 用户2 获胜（超时）/)
  assert.ok(!kv.has("Chess-Plugin:Go:room:group:200"))
})

test("数子确认超时：按估算结果结束", async () => {
  fs.writeFileSync(CONFIG, "go:\n  moveTimeout: 120\n  scoreTimeout: 1\n")
  await dispatch({ user: "1", group: "201", msg: "#发起围棋 9 黑" })
  await dispatch({ user: "2", group: "201", msg: "#加入围棋" })
  await dispatch({ user: "1", group: "201", msg: "E5" })
  await dispatch({ user: "2", group: "201", msg: "#停一手" })
  const last = await dispatch({ user: "1", group: "201", msg: "#停一手" })
  const n = last.replies.length
  await wait(1500)
  const t = textOf(last.replies.slice(n))
  assert.match(t, /数子确认时间到，按估算结果结束[\s\S]*黑方 用户1 胜/)
  assert.ok(!kv.has("Chess-Plugin:Go:room:group:201"))
})

test("重启后恢复", async () => {
  fs.writeFileSync(CONFIG, "go:\n  moveTimeout: 300\n")
  await dispatch({ user: "1", group: "202", msg: "#发起围棋 13 黑" })
  await dispatch({ user: "2", group: "202", msg: "#加入围棋" })
  await dispatch({ user: "1", group: "202", msg: "D4" })
  const fresh = makeDispatcher(await loadApps([`${APP}?restart=${Date.now()}`]))
  let r = await fresh({ user: "2", group: "202", msg: "#棋盘" })
  assert.match(textOf(r.replies), /轮到你落子（白方），限时 5 分钟/)
  r = await fresh({ user: "2", group: "202", msg: "D4" })
  assert.match(textOf(r.replies), /D4 已经有子了/)
  r = await fresh({ user: "2", group: "202", msg: "N13" })
  assert.match(textOf(r.replies), /白方 用户2：N13/)
  await fresh({ user: "1", group: "202", msg: "#结束围棋", isMaster: true })
})
