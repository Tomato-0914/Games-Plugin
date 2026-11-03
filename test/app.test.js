import { test, before } from "node:test"
import assert from "node:assert/strict"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

let dispatch
before(async () => {
  const apps = await loadApps([
    new URL("../apps/Xiangqi/Xiangqi.js", import.meta.url).href,
    new URL("../apps/System/GameHelp.js", import.meta.url).href,
    new URL("../apps/System/GameUpdate.js", import.meta.url).href,
  ])
  dispatch = makeDispatcher(apps)
})

const A = { user: "111", nickname: "小明" }
const B = { user: "222", nickname: "小红" }

test("帮助与英文指令", async () => {
  for (const msg of ["#象棋", "#象棋帮助", "#Chinese_Chess", "#chinese_chess help", "#游戏帮助", "#棋帮助"]) {
    const r = await dispatch({ msg })
    assert.ok(r.handled, msg)
    assert.match(textOf(r.replies), /象棋/)
  }
})

test("双人对战：发起、加入、走子、认输", async () => {
  const g = "900"
  let r = await dispatch({ ...A, group: g, msg: "#发起象棋 红" })
  assert.match(textOf(r.replies), /发起了一局中国象棋（执红方）/)
  r = await dispatch({ ...A, group: g, msg: "#加入象棋" })
  assert.match(textOf(r.replies), /不能和自己对战/)
  r = await dispatch({ ...B, group: g, msg: "#Chinese_Chess join" })
  const t = textOf(r.replies)
  assert.match(t, /对局开始/)
  assert.match(t, /红方：@111/)
  assert.ok(kv.has("Chess-Plugin:Chinese_Chess:room:group:900"))

  // 普通聊天不会被当成走子
  r = await dispatch({ ...A, group: g, msg: "今天天气" })
  assert.equal(r.handled, null)
  // 轮到红方：黑方走 → 提示
  r = await dispatch({ ...B, group: g, msg: "马8进7" })
  assert.match(textOf(r.replies), /还没轮到你/)
  // 旁观者发走法不处理
  r = await dispatch({ user: "333", group: g, msg: "炮二平五" })
  assert.equal(r.handled, null)
  // 非法走法
  // 轮到红方：红方在下（文字棋盘第一行是黑方的纵线编号）
  r = await dispatch({ ...A, group: g, msg: "#棋盘" })
  assert.match(textOf(r.replies), /^１２３４５６７８９/)
  r = await dispatch({ ...A, group: g, msg: "马二进四" })
  assert.match(textOf(r.replies), /马腿/)
  r = await dispatch({ ...A, group: g, msg: "炮二平五" })
  assert.match(textOf(r.replies), /红方 小明：炮二平五/)
  // 轮到黑方：黑方在下
  assert.match(textOf(r.replies), /^一二三四五六七八九/)
  assert.match(textOf(r.replies), /@222/)
  r = await dispatch({ ...B, group: g, msg: "h9g7" })
  assert.match(textOf(r.replies), /黑方 小红：马8进7/)
  // 同一人不能再开局
  r = await dispatch({ ...A, group: "901", msg: "#发起象棋" })
  assert.match(textOf(r.replies), /没下完/)
  // 双人认输需要对方同意
  r = await dispatch({ ...B, group: g, msg: "#认输" })
  assert.match(textOf(r.replies), /@111.*小红 请求认输/)
  r = await dispatch({ ...B, group: g, msg: "#同意认输" })
  assert.match(textOf(r.replies), /等对方同意/)
  r = await dispatch({ ...A, group: g, msg: "#拒绝认输" })
  assert.match(textOf(r.replies), /拒绝了认输/)
  r = await dispatch({ ...B, group: g, msg: "#认输" })
  r = await dispatch({ ...A, group: g, msg: "#同意认输" })
  assert.match(textOf(r.replies), /红方 小明 获胜（认输）/)
  assert.ok(!kv.has("Chess-Plugin:Chinese_Chess:room:group:900"))
})

test("双人对战：悔棋需要对方同意，求和", async () => {
  const g = "902"
  await dispatch({ ...A, group: g, msg: "#发起象棋 红" })
  await dispatch({ ...B, group: g, msg: "#加入象棋" })
  await dispatch({ ...A, group: g, msg: "炮二平五" })
  let r = await dispatch({ ...A, group: g, msg: "#悔棋" })
  assert.match(textOf(r.replies), /@222.*请求悔棋/)
  r = await dispatch({ ...A, group: g, msg: "#同意悔棋" })
  assert.match(textOf(r.replies), /等对方同意/)
  r = await dispatch({ ...B, group: g, msg: "#同意悔棋" })
  assert.match(textOf(r.replies), /对方同意悔棋[\s\S]*@111/)
  r = await dispatch({ ...A, group: g, msg: "#棋盘" })
  assert.match(textOf(r.replies), /轮到你走棋（红方）/)
  r = await dispatch({ ...A, group: g, msg: "#求和" })
  assert.match(textOf(r.replies), /提出和棋/)
  r = await dispatch({ ...B, group: g, msg: "#同意求和" })
  assert.match(textOf(r.replies), /和棋（双方同意和棋）/)
})

test("没有对局时通用指令不拦截", async () => {
  for (const msg of ["#棋盘", "#悔棋", "#认输", "#求和", "#同意悔棋"]) {
    const r = await dispatch({ ...A, group: "903", msg })
    assert.equal(r.handled, null, msg)
  }
})

test("发起人或管理可以取消，等待中的对局", async () => {
  const g = "904"
  await dispatch({ ...A, group: g, msg: "#发起象棋" })
  let r = await dispatch({ ...B, group: g, msg: "#取消象棋" })
  assert.match(textOf(r.replies), /只有发起人/)
  r = await dispatch({ ...B, group: g, msg: "#结束象棋", role: "admin" })
  assert.match(textOf(r.replies), /已取消/)
})

test("人机对战：玩家执黑，AI 先走；走一步 AI 立即应着；悔棋", async () => {
  const g = "905"
  let r = await dispatch({ ...A, group: g, msg: "#人机象棋 简单 黑" })
  let t = textOf(r.replies)
  assert.match(t, /你执黑方，难度：简单/)
  assert.match(t, /红方 柴郡（简单）：/)
  r = await dispatch({ ...A, group: g, msg: "马8进7" })
  t = textOf(r.replies)
  if (!/黑方 小明：马8进7/.test(t)) {
    // 开局库走法可能挡住马路，换一步
    r = await dispatch({ ...A, group: g, msg: "卒7进1" })
    t = textOf(r.replies)
  }
  assert.match(t, /黑方 小明：/)
  assert.match(t, /红方 柴郡（简单）：/)
  r = await dispatch({ ...A, group: g, msg: "#悔棋" })
  assert.match(textOf(r.replies), /已悔棋（本局还剩 2 次）/)
  r = await dispatch({ ...A, group: g, msg: "#悔棋" })
  assert.match(textOf(r.replies), /没有可以悔的棋/)
  r = await dispatch({ ...A, group: g, msg: "#求和" })
  assert.match(textOf(r.replies), /拒绝了求和|接受了求和/)
  r = await dispatch({ ...A, group: g, msg: "#结束象棋" })
  assert.match(textOf(r.replies), /强制结束/)
})

test("私聊人机", async () => {
  const r = await dispatch({ ...A, group: null, msg: "#Chinese_Chess ai easy" })
  assert.match(textOf(r.replies), /你执红方，难度：简单/)
  const r2 = await dispatch({ ...A, group: null, msg: "#发起象棋" })
  assert.match(textOf(r2.replies), /请在群里/)
  await dispatch({ ...A, group: null, msg: "#认输" })
})

test("官方机器人带按钮，其他适配器不带", async () => {
  const g = "906"
  let r = await dispatch({ ...A, group: g, msg: "#发起象棋", adapter: "QQBot" })
  assert.match(textOf(r.replies), /\[按钮:加入对局,取消对局\]/)
  r = await dispatch({ ...B, group: g, msg: "#加入象棋", adapter: "QQBot" })
  assert.match(textOf(r.replies), /\[按钮:悔棋,求和,认输,棋盘\]/)
  const btn = r.replies.flat().find(m => m?.type === "button")
  const resign = btn.data[0].find(b => b.text === "认输")
  assert.deepEqual(resign.permission.sort(), ["111", "222"])
  assert.equal(resign.QQBot.action.data, "#认输")
  r = await dispatch({ ...A, group: g, msg: "#结束象棋", isMaster: true })
  assert.doesNotMatch(textOf(r.replies), /按钮/)
  // 帮助只带三个按钮
  r = await dispatch({ ...A, group: g, msg: "#象棋帮助", adapter: "QQBot" })
  assert.match(textOf(r.replies), /\[按钮:发起对局,加入对局,人机对战\]$/)
  // 人机未指定难度：先发难度按钮，不开局
  r = await dispatch({ ...A, group: g, msg: "#人机象棋 黑", adapter: "QQBot" })
  assert.match(textOf(r.replies), /请选择人机难度（执黑方）\[按钮:入门,简单,普通,困难\]/)
  const pick = r.replies.flat().find(m => m?.type === "button").data[0]
  assert.equal(pick[3].callback, "#人机象棋 困难 黑")
  assert.equal(pick[3].permission, "111")
  r = await dispatch({ ...A, group: g, msg: pick[1].callback, adapter: "QQBot" })
  assert.match(textOf(r.replies), /你执黑方，难度：简单/)
  r = await dispatch({ ...A, group: g, msg: "#认输", adapter: "QQBot" })
  assert.match(textOf(r.replies), /获胜（认输）/)
  r = await dispatch({ ...A, group: "907", msg: "#发起象棋" })
  assert.doesNotMatch(textOf(r.replies), /按钮/)
  await dispatch({ ...A, group: "907", msg: "#取消象棋" })
})

test("多 Bot 同群：只有开局的 Bot 处理", async () => {
  const g = "908"
  global.Bot.bot1 = {}
  global.Bot.bot2 = {}
  await dispatch({ ...A, group: g, msg: "#发起象棋", self: "bot1" })
  let r = await dispatch({ ...B, group: g, msg: "#加入象棋", self: "bot2" })
  assert.equal(r.handled, null)
  r = await dispatch({ ...B, group: g, msg: "#加入象棋", self: "bot1" })
  assert.match(textOf(r.replies), /对局开始/)
  await dispatch({ ...A, group: g, msg: "#结束象棋", isMaster: true, self: "bot1" })
  delete global.Bot.bot1
  delete global.Bot.bot2
})

test("更新指令仅主人可用", async () => {
  for (const msg of ["#游戏更新", "游戏更新", "#游戏强制更新", "#棋更新", "#棋强制更新"]) {
    const r = await dispatch({ ...A, msg })
    assert.match(textOf(r.replies), /只有主人/, msg)
  }
  assert.equal((await dispatch({ ...A, msg: "#棋类更新" })).handled, null)
})

test("棋盘使用内置字体", async () => {
  const { fontUrl } = await import("../components/Render.js")
  const { renderHtml } = await import("../games/xiangqi/Render.js")
  const { XiangqiGame } = await import("../games/xiangqi/Game.js")
  assert.match(fontUrl, /^file:\/\/.*LXGWWenKai-Medium\.woff2$/)
  assert.match(renderHtml(new XiangqiGame(), { fontUrl }), /@font-face \{ font-family: "ChessKai"; src: url\("file:/)
})

test("游戏帮助按分类列出游戏，游戏版本", async () => {
  let r = await dispatch({ ...A, msg: "#游戏帮助" })
  assert.match(textOf(r.replies), /游戏帮助[\s\S]*中国象棋 棋类 · Chinese_Chess[\s\S]*#象棋帮助[\s\S]*#游戏更新/)
  for (const msg of ["#游戏版本", "#棋版本"]) {
    r = await dispatch({ ...A, msg })
    assert.match(textOf(r.replies), /Games-Plugin v1\.3\.1/, msg)
  }
  for (const msg of ["#棋类帮助", "#棋类版本"]) assert.equal((await dispatch({ ...A, msg })).handled, null, msg)
})

test("帮助图片 HTML", async () => {
  const { renderHelpHtml } = await import("../components/Help.js")
  const html = renderHelpHtml({ title: "中国象棋", sections: [{ title: "走棋", items: [{ cmd: "<b>", desc: "x" }] }] }, "file:///font.woff2")
  assert.match(html, /@font-face/)
  assert.match(html, /&lt;b&gt;/)
})
