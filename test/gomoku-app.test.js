import { test, before } from "node:test"
import assert from "node:assert/strict"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

let dispatch
const KEY = g => `Chess-Plugin:Gomoku:room:group:${g}`
before(async () => {
  dispatch = makeDispatcher(await loadApps([
    new URL("../apps/Xiangqi/Xiangqi.js", import.meta.url).href,
    new URL("../apps/Gomoku/Gomoku.js", import.meta.url).href,
    new URL("../apps/Minesweeper/Minesweeper.js", import.meta.url).href,
    new URL("../apps/System/GameHelp.js", import.meta.url).href,
  ]))
})

const A = { user: "111", nickname: "小明" }
const B = { user: "222", nickname: "小红" }

test("帮助与登记", async () => {
  let r = await dispatch({ msg: "#五子棋帮助" })
  assert.match(textOf(r.replies), /五子棋[\s\S]*三三、四四/)
  r = await dispatch({ msg: "#Gomoku" })
  assert.equal(r.handled, "help")
  r = await dispatch({ msg: "#游戏帮助" })
  assert.match(textOf(r.replies), /五子棋 棋类 · Gomoku/)
})

test("双人：发起、加入、落子、禁手拒绝、五连获胜", async () => {
  const g = "500"
  let r = await dispatch({ ...A, group: g, msg: "#发起五子棋 黑" })
  assert.match(textOf(r.replies), /发起了一局五子棋（执黑方）/)
  r = await dispatch({ ...B, group: g, msg: "#Gomoku join" })
  assert.match(textOf(r.replies), /对局开始[\s\S]*黑方：@111[\s\S]*白方：@222/)
  assert.ok(kv.has(KEY(g)))
  // 不是自己的回合、旁观者、普通聊天
  r = await dispatch({ ...B, group: g, msg: "H8" })
  assert.match(textOf(r.replies), /还没轮到你/)
  r = await dispatch({ user: "333", group: g, msg: "H8" })
  assert.equal(r.handled, null)
  r = await dispatch({ ...A, group: g, msg: "hello" })
  assert.equal(r.handled, null)
  // 黑 F8 G8 H6 H7，白随便下，然后黑下 H8 = 三三
  const seq = [[A, "F8"], [B, "A1"], [A, "g8"], [B, "1B"], [A, "下H6"], [B, "A3"], [A, "H7"], [B, "B3"]]
  for (const [p, m] of seq) {
    r = await dispatch({ ...p, group: g, msg: m })
    assert.doesNotMatch(textOf(r.replies), /❌/, m)
  }
  // 黑方回合，棋盘标出禁手点
  assert.match(textOf(r.replies), /×/)
  r = await dispatch({ ...A, group: g, msg: "H8" })
  assert.match(textOf(r.replies), /H8 是黑方禁手（三三）/)
  r = await dispatch({ ...A, group: g, msg: "H7" })
  assert.match(textOf(r.replies), /H7 已经有子了/)
  r = await dispatch({ ...A, group: g, msg: "P1" })
  assert.match(textOf(r.replies), /坐标超出棋盘/)
  // 黑连成 D8 E8 F8 G8 + H8? H8 禁手但成五优先
  for (const [p, m] of [[A, "E8"], [B, "C1"], [A, "D8"], [B, "C3"]]) await dispatch({ ...p, group: g, msg: m })
  r = await dispatch({ ...A, group: g, msg: "H8" })
  assert.match(textOf(r.replies), /黑方 小明 获胜（五连），共 13 手/)
  assert.ok(!kv.has(KEY(g)))
})

test("双人：悔棋、求和、认输都需要对方同意", async () => {
  const g = "501"
  await dispatch({ ...A, group: g, msg: "#发起五子棋 白" })
  await dispatch({ ...B, group: g, msg: "#加入五子棋" })
  await dispatch({ ...B, group: g, msg: "H8" })
  let r = await dispatch({ ...B, group: g, msg: "#悔棋" })
  assert.match(textOf(r.replies), /@111.*请求悔棋/)
  r = await dispatch({ ...A, group: g, msg: "#同意悔棋" })
  assert.match(textOf(r.replies), /对方同意悔棋[\s\S]*@222/)
  r = await dispatch({ ...B, group: g, msg: "#求和" })
  r = await dispatch({ ...A, group: g, msg: "#拒绝求和" })
  assert.match(textOf(r.replies), /拒绝了和棋/)
  r = await dispatch({ ...A, group: g, msg: "#认输" })
  assert.match(textOf(r.replies), /@222.*请求认输/)
  r = await dispatch({ ...B, group: g, msg: "#同意认输" })
  assert.match(textOf(r.replies), /黑方 小红 获胜（认输）/)
})

test("人机：执白时 AI 先下；落子后 AI 立即应着；悔棋", async () => {
  const g = "502"
  let r = await dispatch({ ...A, group: g, msg: "#人机五子棋 简单 白" })
  assert.match(textOf(r.replies), /你执白方，难度：简单[\s\S]*黑方 柴郡（简单）：[A-O]\d+/)
  r = await dispatch({ ...A, group: g, msg: "A15" })
  assert.match(textOf(r.replies), /白方 小明：A15[\s\S]*黑方 柴郡（简单）：[A-O]\d+/)
  r = await dispatch({ ...A, group: g, msg: "#悔棋" })
  assert.match(textOf(r.replies), /已悔棋（本局还剩 2 次）/)
  r = await dispatch({ ...A, group: g, msg: "#悔棋" })
  assert.match(textOf(r.replies), /没有可以悔的棋/)
  r = await dispatch({ ...A, group: g, msg: "#认输" })
  assert.match(textOf(r.replies), /获胜（认输）/)
})

test("官方机器人：不写难度先发按钮；对局按钮带落子输入按钮", async () => {
  const g = "503"
  let r = await dispatch({ ...A, group: g, msg: "#人机五子棋", adapter: "QQBot" })
  assert.match(textOf(r.replies), /请选择人机难度（执黑方）\[按钮:简单,普通,困难\]/)
  r = await dispatch({ ...A, group: g, msg: "#人机五子棋 普通", adapter: "QQBot" })
  assert.match(textOf(r.replies), /\[按钮:落子,悔棋,求和,认输\]/)
  const rows = r.replies.flat().find(m => m?.type === "button").data
  assert.deepEqual([rows[0][0].input, rows[0][0].send], ["下", false])
  r = await dispatch({ ...A, group: g, msg: "#五子棋帮助", adapter: "QQBot" })
  assert.match(textOf(r.replies), /\[按钮:发起对局,加入对局,人机对战\]$/)
  await dispatch({ ...A, group: g, msg: "#结束五子棋" })
})

test("同一个群可以同时下象棋、五子棋、扫雷，指令互不干扰", async () => {
  const g = "504"
  await dispatch({ ...A, group: g, msg: "#人机象棋 简单" })
  await dispatch({ ...B, group: g, msg: "#人机五子棋 简单" })
  await dispatch({ user: "333", group: g, msg: "#扫雷 初级" })
  let r = await dispatch({ ...A, group: g, msg: "h2e2" })
  assert.match(textOf(r.replies), /红方 小明：炮二平五/)
  r = await dispatch({ ...B, group: g, msg: "H8" })
  assert.match(textOf(r.replies), /黑方 小红：H8/)
  r = await dispatch({ user: "333", group: g, msg: "E5" })
  assert.match(textOf(r.replies), /翻开 E5/)
  // 认输各自归属
  r = await dispatch({ ...B, group: g, msg: "#认输" })
  assert.match(textOf(r.replies), /黑方 小红 认输/)
  r = await dispatch({ ...A, group: g, msg: "#认输" })
  assert.match(textOf(r.replies), /红方 小明 认输/)
  await dispatch({ user: "333", group: g, msg: "#结束扫雷" })
})
