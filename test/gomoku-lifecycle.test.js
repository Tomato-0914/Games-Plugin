import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

const CONFIG = new URL("../config/config.yaml", import.meta.url)
const APP = new URL("../apps/Gomoku/Gomoku.js", import.meta.url).href
let backup = null
let dispatch
const wait = ms => new Promise(r => setTimeout(r, ms))

before(async () => {
  if (fs.existsSync(CONFIG)) backup = fs.readFileSync(CONFIG, "utf8")
  fs.writeFileSync(CONFIG, "gomoku:\n  moveTimeout: 2\n  moveWarnBefore: 1\n")
  dispatch = makeDispatcher(await loadApps([APP]))
})
after(() => {
  if (backup === null) fs.unlinkSync(CONFIG)
  else fs.writeFileSync(CONFIG, backup)
})

test("超时前提醒，超时判负", async () => {
  await dispatch({ user: "1", group: "400", msg: "#发起五子棋 黑" })
  const join = await dispatch({ user: "2", group: "400", msg: "#加入五子棋" })
  const n = join.replies.length
  await wait(2600)
  const t = textOf(join.replies.slice(n))
  assert.match(t, /@1 ⏰ 还剩 1 秒/)
  assert.match(t, /黑方 用户1 超时未落子[\s\S]*白方 用户2 获胜（超时）/)
  assert.ok(!kv.has("Chess-Plugin:Gomoku:room:group:400"))
})

test("重启后恢复", async () => {
  fs.writeFileSync(CONFIG, "gomoku:\n  moveTimeout: 120\n")
  await dispatch({ user: "1", group: "401", msg: "#发起五子棋 黑" })
  await dispatch({ user: "2", group: "401", msg: "#加入五子棋" })
  await dispatch({ user: "1", group: "401", msg: "H8" })
  const fresh = makeDispatcher(await loadApps([`${APP}?restart=${Date.now()}`]))
  let r = await fresh({ user: "2", group: "401", msg: "#棋盘" })
  assert.match(textOf(r.replies), /轮到你落子（白方）/)
  r = await fresh({ user: "2", group: "401", msg: "H8" })
  assert.match(textOf(r.replies), /H8 已经有子了/)
  r = await fresh({ user: "2", group: "401", msg: "I9" })
  assert.match(textOf(r.replies), /白方 用户2：I9/)
  await fresh({ user: "1", group: "401", msg: "#结束五子棋", isMaster: true })
})
