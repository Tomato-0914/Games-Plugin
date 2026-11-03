import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

const CONFIG = new URL("../config/config.yaml", import.meta.url)
const APP = new URL("../apps/Minesweeper/Minesweeper.js", import.meta.url).href
let backup = null
let dispatch
const wait = ms => new Promise(r => setTimeout(r, ms))

before(async () => {
  if (fs.existsSync(CONFIG)) backup = fs.readFileSync(CONFIG, "utf8")
  fs.writeFileSync(CONFIG, "minesweeper:\n  idleTimeout: 2\n  idleWarnBefore: 1\n  hintLimit: 999\n  hintPenalty: 0\n")
  dispatch = makeDispatcher(await loadApps([APP]))
})
after(() => {
  if (backup === null) fs.unlinkSync(CONFIG)
  else fs.writeFileSync(CONFIG, backup)
})

test("闲置提醒，超时判定失败", async () => {
  await dispatch({ user: "1", group: "600", msg: "#扫雷 初级" })
  const move = await dispatch({ user: "1", group: "600", msg: "E5" })
  const n = move.replies.length
  await wait(2600)
  // 计时器的消息回复在最后一条操作消息下面
  const t = textOf(move.replies.slice(n))
  assert.match(t, /@1 ⏰ 扫雷 1 秒内没有操作将判定失败/)
  assert.match(t, /⌛ 2 秒没有操作，判定失败/)
  assert.ok(!kv.has("Chess-Plugin:Minesweeper:room:group:600"))
})

test("一直用提示可以扫完（无猜棋盘）", async () => {
  fs.writeFileSync(CONFIG, "minesweeper:\n  hintLimit: 999\n  hintPenalty: 0\n")
  const g = "601"
  await dispatch({ user: "1", group: g, msg: "#扫雷 中级" })
  await dispatch({ user: "1", group: g, msg: "H8" })
  let text = ""
  for (let k = 0; k < 300 && !/扫雷成功|踩到雷/.test(text); k++) {
    text = textOf((await dispatch({ user: "1", group: g, msg: "#扫雷提示" })).replies)
  }
  assert.match(text, /🎉 扫雷成功！用时 \d\d:\d\d/)
})

test("重启后恢复", async () => {
  const g = "602"
  await dispatch({ user: "1", group: g, msg: "#扫雷 高级" })
  await dispatch({ user: "1", group: g, msg: "H15" })
  await dispatch({ user: "1", group: g, msg: "旗a1" })
  const fresh = makeDispatcher(await loadApps([`${APP}?restart=${Date.now()}`]))
  const r = await fresh({ user: "1", group: g, msg: "#扫雷盘面" })
  assert.match(textOf(r.replies), /小明|1 的扫雷/)
  const t = textOf((await fresh({ user: "1", group: g, msg: "!a1" })).replies)
  assert.match(t, /取消A1/)
  await fresh({ user: "1", group: g, msg: "#结束扫雷" })
})
