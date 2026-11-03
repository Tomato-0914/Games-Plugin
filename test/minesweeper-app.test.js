import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { kv, loadApps, makeDispatcher, textOf } from "./support/yunzai.js"

const CONFIG = new URL("../config/config.yaml", import.meta.url)
let backup = null
let dispatch
const KEY = scope => `Chess-Plugin:Minesweeper:room:${scope}`

before(async () => {
  if (fs.existsSync(CONFIG)) backup = fs.readFileSync(CONFIG, "utf8")
  fs.writeFileSync(CONFIG, "minesweeper:\n  hintLimit: 1\n")
  dispatch = makeDispatcher(await loadApps([
    new URL("../apps/Xiangqi/Xiangqi.js", import.meta.url).href,
    new URL("../apps/Minesweeper/Minesweeper.js", import.meta.url).href,
    new URL("../apps/System/GameHelp.js", import.meta.url).href,
  ]))
})
after(() => {
  if (backup === null) fs.unlinkSync(CONFIG)
  else fs.writeFileSync(CONFIG, backup)
})

const A = { user: "111", nickname: "小明" }
const B = { user: "222", nickname: "小红" }

test("帮助、游戏帮助登记", async () => {
  let r = await dispatch({ msg: "#扫雷帮助" })
  assert.match(textOf(r.replies), /扫雷[\s\S]*旗C5[\s\S]*c1c2c3/)
  r = await dispatch({ msg: "#游戏帮助" })
  assert.match(textOf(r.replies), /扫雷 益智 · Minesweeper/)
  r = await dispatch({ msg: "#Minesweeper help" })
  assert.equal(r.handled, "help")
})

test("开局、第一下安全、插旗、批量、一个群只能一盘、结束", async () => {
  const g = "700"
  let r = await dispatch({ ...A, group: g, msg: "#扫雷 中级" })
  assert.match(textOf(r.replies), /扫雷 · 中级（16×16，40 颗雷）/)
  assert.ok(kv.has(KEY(`group:${g}`)))
  // 其他人不能再开，也不能操作
  r = await dispatch({ ...B, group: g, msg: "#扫雷" })
  assert.match(textOf(r.replies), /本群正在扫雷（小明）/)
  r = await dispatch({ ...B, group: g, msg: "H8" })
  assert.equal(r.handled, null)
  // 普通聊天不处理
  r = await dispatch({ ...A, group: g, msg: "hello" })
  assert.equal(r.handled, null)
  // 第一下必定安全，并且会打开一片
  r = await dispatch({ ...A, group: g, msg: "H8" })
  let t = textOf(r.replies)
  assert.match(t, /翻开 H8，打开了 \d+ 格/)
  assert.doesNotMatch(t, /踩到雷/)
  // 越界
  r = await dispatch({ ...A, group: g, msg: "Q1" })
  assert.match(textOf(r.replies), /没有 Q 行/)
  // 插旗 / 取消
  r = await dispatch({ ...A, group: g, msg: "旗a1a2" })
  assert.match(textOf(r.replies), /插旗：A1、A2/)
  r = await dispatch({ ...A, group: g, msg: "!a1" })
  assert.match(textOf(r.replies), /插旗：取消A1/)
  // 插旗的格子不能翻开
  r = await dispatch({ ...A, group: g, msg: "a2" })
  assert.match(textOf(r.replies), /A2 插了旗/)
  // 管理可以结束
  r = await dispatch({ ...B, group: g, msg: "#结束扫雷" })
  assert.match(textOf(r.replies), /只有正在扫雷的人/)
  r = await dispatch({ ...A, group: g, msg: "#结束扫雷" })
  assert.match(textOf(r.replies), /已结束 小明 的扫雷/)
  assert.ok(!kv.has(KEY(`group:${g}`)))
})

test("提示：每局一次；自动翻开开关", async () => {
  const g = "701"
  await dispatch({ ...A, group: g, msg: "#扫雷 初级" })
  let r = await dispatch({ ...A, group: g, msg: "#扫雷提示" })
  assert.match(textOf(r.replies), /第一下必定安全/)
  await dispatch({ ...A, group: g, msg: "E5" })
  r = await dispatch({ ...A, group: g, msg: "#扫雷提示" })
  const t = textOf(r.replies)
  assert.match(t, /提示：[A-I]\d 是安全的|扫雷成功/)
  if (!/扫雷成功/.test(t)) {
    r = await dispatch({ ...A, group: g, msg: "#扫雷提示" })
    assert.match(textOf(r.replies), /1 次提示已经用完/)
    r = await dispatch({ ...A, group: g, msg: "#扫雷自动 开" })
    assert.match(textOf(r.replies), /自动翻开：开/)
    r = await dispatch({ ...A, group: g, msg: "#扫雷自动" })
    assert.match(textOf(r.replies), /自动翻开：关/)
    await dispatch({ ...A, group: g, msg: "#结束扫雷" })
  }
})

test("自定义难度与校验", async () => {
  const g = "702"
  let r = await dispatch({ ...A, group: g, msg: "#扫雷 自定义 10 20" })
  assert.match(textOf(r.replies), /自定义格式/)
  r = await dispatch({ ...A, group: g, msg: "#扫雷 自定义 30 30 10" })
  assert.match(textOf(r.replies), /大小超出范围/)
  r = await dispatch({ ...A, group: g, msg: "#扫雷 自定义 10 10 50" })
  assert.match(textOf(r.replies), /雷数超出范围：1–30/)
  r = await dispatch({ ...A, group: g, msg: "#Minesweeper start custom 6 8 5" })
  assert.match(textOf(r.replies), /自定义 6×8（6×8，5 颗雷）/)
  await dispatch({ ...A, group: g, msg: "#结束扫雷" })
})

test("官方机器人：不写难度先发按钮；对局按钮", async () => {
  const g = "703"
  let r = await dispatch({ ...A, group: g, msg: "#扫雷", adapter: "QQBot" })
  assert.match(textOf(r.replies), /请选择扫雷难度\[按钮:初级,中级,高级\]/)
  const btn = r.replies.flat().find(m => m?.type === "button").data[0]
  assert.equal(btn[2].callback, "#扫雷 高级")
  assert.equal(btn[2].permission, "111")
  assert.ok(!kv.has(KEY(`group:${g}`)))
  r = await dispatch({ ...A, group: g, msg: btn[0].callback, adapter: "QQBot" })
  assert.match(textOf(r.replies), /\[按钮:翻开,插旗,提示,自动：关,结束\]/)
  const rows = r.replies.flat().find(m => m?.type === "button").data
  assert.deepEqual(rows[0].map(b => [b.text, b.input, b.send, b.permission]), [["翻开", "开", false, "111"], ["插旗", "旗", false, "111"]])
  assert.equal(rows[0][0].callback, undefined)
  // 输入按钮填入的文字加坐标可以直接用
  r = await dispatch({ ...A, group: g, msg: "开E5", adapter: "QQBot" })
  assert.match(textOf(r.replies), /翻开 E5，打开了 \d+ 格/)
  r = await dispatch({ ...A, group: g, msg: "旗 a1", adapter: "QQBot" })
  assert.match(textOf(r.replies), /插旗：A1|A1 已经翻开/)
  r = await dispatch({ ...A, group: g, msg: "#结束扫雷", adapter: "QQBot" })
  assert.match(textOf(r.replies), /\[按钮:再来一盘,换个难度\]/)
  // 其他适配器不写难度直接开默认难度
  r = await dispatch({ ...A, group: g, msg: "#扫雷" })
  assert.match(textOf(r.replies), /扫雷 · 初级/)
  await dispatch({ ...A, group: g, msg: "#结束扫雷" })
})

test("象棋坐标不会被扫雷抢走", async () => {
  const g = "704"
  await dispatch({ ...A, group: g, msg: "#人机象棋 简单" })
  const r = await dispatch({ ...A, group: g, msg: "h2e2" })
  assert.match(textOf(r.replies), /红方 小明：炮二平五/)
  await dispatch({ ...A, group: g, msg: "#结束象棋" })
})

test("私聊每人一盘", async () => {
  let r = await dispatch({ ...A, group: null, msg: "#扫雷 初级" })
  assert.match(textOf(r.replies), /扫雷 · 初级/)
  r = await dispatch({ ...B, group: null, msg: "#扫雷 初级" })
  assert.match(textOf(r.replies), /扫雷 · 初级/)
  await dispatch({ ...A, group: null, msg: "#结束扫雷" })
  await dispatch({ ...B, group: null, msg: "#结束扫雷" })
})
