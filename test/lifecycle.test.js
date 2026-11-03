import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

const CONFIG = new URL("../config/config.yaml", import.meta.url)
let backup = null
let dispatch

before(async () => {
  if (fs.existsSync(CONFIG)) backup = fs.readFileSync(CONFIG, "utf8")
  fs.writeFileSync(CONFIG, "xiangqi:\n  moveTimeout: 2\n  moveWarnBefore: 1\n")
  dispatch = makeDispatcher(await loadApps([new URL("../apps/Xiangqi/Xiangqi.js", import.meta.url).href]))
})

after(() => {
  if (backup === null) fs.unlinkSync(CONFIG)
  else fs.writeFileSync(CONFIG, backup)
})

const wait = ms => new Promise(r => setTimeout(r, ms))

test("超时前提醒，超时判负（回复最后一条消息）", async () => {
  const g = "800"
  await dispatch({ user: "1", group: g, msg: "#发起象棋 黑" })
  const join = await dispatch({ user: "2", group: g, msg: "#加入象棋" })
  // 红方（2）不走棋
  const before = join.replies.length
  await wait(2600)
  const t = textOf(join.replies.slice(before))
  assert.match(t, /还剩 1 秒/)
  assert.match(t, /红方 用户2 超时未走棋[\s\S]*黑方 用户1 获胜（超时）/)
  assert.ok(!kv.has("Chess-Plugin:Chinese_Chess:room:group:800"))
})

test("重启后从 Redis 恢复对局", async () => {
  const g = "801"
  fs.writeFileSync(CONFIG, "xiangqi:\n  moveTimeout: 120\n")
  await dispatch({ user: "1", group: g, msg: "#发起象棋 红" })
  await dispatch({ user: "2", group: g, msg: "#加入象棋" })
  await dispatch({ user: "1", group: g, msg: "炮二平五" })
  assert.ok(kv.has("Chess-Plugin:Chinese_Chess:room:group:801"))

  // 重新加载模块，模拟进程重启（新的内存状态，Redis 数据保留）
  const fresh = makeDispatcher(await loadApps([new URL(`../apps/Xiangqi/Xiangqi.js?restart=${Date.now()}`, import.meta.url).href]))
  let r = await fresh({ user: "2", group: g, msg: "#棋盘" })
  assert.match(textOf(r.replies), /轮到你走棋（黑方）/)
  assert.match(textOf(r.replies), /炮二平五|将/)
  r = await fresh({ user: "2", group: g, msg: "马8进7" })
  assert.match(textOf(r.replies), /黑方 用户2：马8进7/)
  await fresh({ user: "2", group: g, msg: "#结束象棋", isMaster: true })
})
