import { plugin, segment, Config, isQQBot, makeButtons, playerName, isAdmin } from "../../components/index.js"
import { RoomStore } from "../../components/Room.js"
import { screenshot, fontUrl } from "../../components/Render.js"
import { helpMessage } from "../../components/Help.js"
import { Minefield, LEVELS, LEVEL_NAMES } from "../../games/minesweeper/Board.js"
import { generate, deduce } from "../../games/minesweeper/Solver.js"
import { parseOps, looksLikeOps, cellName } from "../../games/minesweeper/Notation.js"
import { renderHtml, renderText, formatTime } from "../../games/minesweeper/Render.js"

/* ================= 玩法 =================
 * 单人扫雷：一个群同时只能有一盘（只有开局的人能操作），私聊每人一盘
 * #扫雷 [初级/中级/高级/自定义 行 列 雷数]（官方机器人下不写难度时先发难度按钮）
 * 操作：C5 翻开、旗C5 插旗、c1c2c3 多格；对已翻开的数字再发一次坐标 = 快速翻开
 * #扫雷盘面 #扫雷提示 #扫雷自动 [开/关] #结束扫雷
 * 第一下必定安全；无猜模式下只靠推理就能扫完；10 分钟无操作判定失败
 */

export const GAME_ID = "Minesweeper"
const reg = source => new RegExp(source, "i")
const store = new RoomStore(GAME_ID)
const cfg = () => Config.all.minesweeper || {}
const ENGLISH_LEVEL = { easy: "初级", medium: "中级", hard: "高级" }

/* ================= 房间 ================= */

class Room {
  constructor(data) {
    Object.assign(this, data)
    this.lastEvent = null
  }

  members() {
    return [String(this.player.id)]
  }

  /** 已用时间（秒，含提示加时） */
  get elapsed() {
    if (!this.startAt) return 0
    return ((this.endAt || Date.now()) - this.startAt) / 1000 + (this.penalty || 0)
  }

  serialize() {
    const { lastEvent, field, ...rest } = this
    return { ...rest, field: field.toJSON() }
  }

  static from(data) {
    return new Room({ ...data, field: Minefield.fromJSON(data.field) })
  }
}

function context(e) {
  const scope = e.isGroup ? `group:${e.group_id}` : `private:${e.user_id}`
  const room = store.get(scope)
  let foreign = false
  if (room && e.self_id && String(room.selfId) !== String(e.self_id)) {
    if (global.Bot?.[room.selfId]) foreign = true
    else room.selfId = e.self_id
  }
  return { scope, room, foreign }
}

const isPlayer = (room, e) => String(room.player.id) === String(e.user_id)
const at = (room, id) => (room.isGroup ? [segment.at(id), " "] : [])

/* ================= 消息 ================= */

function levelLabel(room) {
  return room.level === "自定义" ? `自定义 ${room.rows}×${room.cols}` : room.level
}

function gameButtons(e, room) {
  const id = String(room.player.id)
  return makeButtons(e, [[
    { text: "盘面", cmd: "#扫雷盘面" },
    { text: "提示", cmd: "#扫雷提示", permission: id },
    { text: room.auto ? "自动翻开：开" : "自动翻开：关", cmd: "#扫雷自动", permission: id },
    { text: "结束", cmd: "#结束扫雷", permission: id },
  ]])
}

function levelButtons(e, permission) {
  return makeButtons(e, [LEVEL_NAMES.map(l => ({ text: l, cmd: `#扫雷 ${l}`, permission }))])
}

async function boardMessage(e, room, parts = [], { status = "", last = [] } = {}) {
  const f = room.field
  const limit = Number(cfg().hintLimit) || 0
  const img = await screenshot(renderHtml(f, {
    title: `扫雷 · ${levelLabel(room)}`,
    player: room.player.name,
    steps: room.steps || 0,
    elapsed: room.elapsed,
    status,
    last,
    auto: !!room.auto,
    hints: limit ? `${room.hintsUsed || 0}/${limit}` : "",
    fontUrl,
  }), `minesweeper-${room.scope}`)
  const msg = []
  if (img) msg.push(img)
  else if (Config.render?.textFallback !== false) msg.push(`${renderText(f)}\n`)
  msg.push(...parts)
  const buttons = f.ended
    ? makeButtons(e, [[
      { text: "再来一盘", cmd: room.level === "自定义" ? `#扫雷 自定义 ${room.rows} ${room.cols} ${room.mines}` : `#扫雷 ${room.level}` },
      { text: "换个难度", cmd: "#扫雷" },
    ]])
    : gameButtons(e, room)
  if (buttons) msg.push(buttons)
  return msg
}

async function send(room, e, msg) {
  try {
    if (e?.reply) return await e.reply(msg)
  } catch (err) {
    logger.error(`[Games-Plugin] 回复失败：${err.message}`)
  }
  try {
    const bot = global.Bot?.[room.selfId] || global.Bot
    const target = room.isGroup ? bot?.pickGroup?.(room.groupId) : bot?.pickFriend?.(room.userId)
    return await target?.sendMsg?.(msg)
  } catch (err) {
    logger.error(`[Games-Plugin] 主动发送失败：${err.message}`)
  }
}

/** 结束并公布结果 */
async function finish(room, e, lines, { status, last = [] } = {}) {
  room.endAt = room.endAt || Date.now()
  room.status = "ended"
  await store.remove(room.scope)
  await send(room, e, await boardMessage(e, room, lines, { status, last }))
  return true
}

function winText(room) {
  const extra = room.penalty ? `（含提示加时 ${room.penalty} 秒）` : ""
  return `🎉 扫雷成功！用时 ${formatTime(room.elapsed)}${extra}，共 ${room.steps} 步`
}

/* ================= 计时 ================= */

const isCurrent = room => store.get(room.scope) === room

function arm(room) {
  const c = cfg()
  const timeout = Number(c.idleTimeout) || 0
  store.clearTimers(room.scope)
  if (timeout <= 0) return
  const deadline = room.lastActionAt + timeout * 1000
  const now = Date.now()
  store.setTimer(room.scope, "idle", deadline - now, () => onIdle(room))
  const warn = Number(c.idleWarnBefore) || 0
  if (warn > 0 && warn < timeout) store.setTimer(room.scope, "warn", deadline - warn * 1000 - now, () => onWarn(room))
}

const duration = sec => (sec >= 60 ? `${Math.round(sec / 60)} 分钟` : `${sec} 秒`)

async function onWarn(room) {
  if (!isCurrent(room) || room.status !== "playing") return
  const warn = Number(cfg().idleWarnBefore) || 0
  await send(room, room.lastEvent, [...at(room, room.player.id), `⏰ 扫雷 ${duration(warn)}内没有操作将判定失败`])
}

async function onIdle(room) {
  if (!isCurrent(room) || room.status !== "playing") return
  room.field.giveUp()
  const idle = duration(Number(cfg().idleTimeout) || 0)
  await finish(room, room.lastEvent, [...at(room, room.player.id), `⌛ ${idle}没有操作，判定失败`], { status: "超时" })
}

/* ================= 重启恢复 ================= */

let restored = false
async function restore() {
  if (restored) return
  restored = true
  let count = 0
  for (const data of await store.loadAll()) {
    try {
      const room = Room.from(data)
      if (room.status !== "playing" || room.field.ended) {
        await store.remove(room.scope)
        continue
      }
      // 停机期间不计入闲置时间
      room.lastActionAt = Date.now()
      store.set(room)
      arm(room)
      count++
    } catch (err) {
      logger.error(`[Games-Plugin] 恢复扫雷失败：${err.message}`)
      await store.remove(data.scope)
    }
  }
  if (count) logger.mark(`[Games-Plugin] 已恢复 ${count} 盘扫雷`)
}

/* ================= 指令 ================= */

const START_RE = reg(`^#?(?:开始)?(?:扫雷|Minesweeper(?:\\s*start)?)\\s*(初级|中级|高级|easy|medium|hard|(?:自定义|custom)[\\s\\d,，x×*]*)?\\s*$`)

export class Minesweeper extends plugin {
  constructor() {
    super({
      name: "Games-扫雷",
      dsc: "单人扫雷",
      event: "message",
      priority: 110,
      rule: [
        { reg: reg("^#?(?:扫雷|Minesweeper\\s*)(?:帮助|help)$"), fnc: "help" },
        { reg: reg("^#?(?:扫雷(?:盘面|棋盘)|Minesweeper\\s*board)$"), fnc: "board" },
        { reg: reg("^#?(?:结束扫雷|Minesweeper\\s*end)$"), fnc: "end" },
        { reg: reg("^#?(?:扫雷提示|Minesweeper\\s*hint)$"), fnc: "hint" },
        { reg: reg("^#?(?:扫雷自动(?:翻开)?|Minesweeper\\s*auto)\\s*(开|关|on|off)?$"), fnc: "auto" },
        { reg: START_RE, fnc: "start" },
        { reg: /^\s*#?\s*(?:插旗|旗|标记|标|!|！)?\s*(?:[a-zA-Z]\d{1,2}[\s,，、]*)+$/, fnc: "ops", log: false },
      ],
    })
  }

  async init() {
    await restore()
  }

  /* ---------- 帮助 ---------- */

  async help(e) {
    const c = cfg()
    const limit = Number(c.hintLimit) || 0
    const idle = Math.round((Number(c.idleTimeout) || 0) / 60)
    const data = {
      title: "扫雷",
      subtitle: "单人模式 · 第一下必定安全",
      piece: "雷",
      color: "black",
      badge: GAME_ID,
      sections: [
        {
          title: "开局",
          piece: "开",
          items: [
            { cmd: "#扫雷", desc: isQQBot(e) ? "选择难度后开始" : `默认${c.defaultLevel || "初级"}` },
            { cmd: "#扫雷 初级", desc: "9×9，10 颗雷（也可以写 中级 16×16 / 高级 16×30）" },
            { cmd: "#扫雷 自定义 10 20 30", desc: `10 行 20 列 30 颗雷（最大 ${c.maxRows || 20} 行 ${c.maxCols || 30} 列）` },
          ],
        },
        {
          title: "操作",
          tag: "直接发送坐标",
          piece: "旗",
          color: "black",
          items: [
            { cmd: "C5", desc: "翻开 C 行第 5 列（行字母 + 列数字）" },
            { cmd: "旗C5", desc: "插旗，再发一次取消（也可以写 标C5、!C5）" },
            { cmd: "c1c2c3", desc: "一次操作多格，空格、逗号可有可无" },
            { cmd: "已翻开的数字", desc: "再发一次坐标：旗数对得上时自动翻开周围" },
          ],
        },
        {
          title: "对局中",
          piece: "局",
          items: [
            { cmd: "#扫雷盘面", desc: "重新发送盘面" },
            ...(limit ? [{ cmd: "#扫雷提示", desc: `翻开一个安全格，每局 ${limit} 次${c.hintPenalty ? `，计时 +${c.hintPenalty} 秒` : ""}` }] : []),
            { cmd: "#扫雷自动 开/关", desc: "数字周围旗数对得上时自动展开" },
            { cmd: "#结束扫雷", desc: "放弃这一盘，显示所有雷" },
          ],
          notes: [
            c.noGuess !== false ? "无猜模式：只靠推理就能扫完，不用碰运气" : "第一下翻开的格子和周围 8 格不会有雷",
            `一个群同时只能有一盘${idle ? `；${idle} 分钟没有操作判定失败` : ""}`,
          ],
        },
      ],
      footer: "English: #Minesweeper start easy | medium | hard | custom 10 20 30, board, hint, auto on/off, end",
    }
    const msg = [await helpMessage(data, "help-minesweeper")]
    const buttons = levelButtons(e)
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  /* ---------- 开局 ---------- */

  async start(e) {
    const c = cfg()
    const { scope, room, foreign } = context(e)
    if (foreign) return false
    if (room) {
      await e.reply(isPlayer(room, e) ? "你还有一盘扫雷没完成，发送 #扫雷盘面 查看，或 #结束扫雷 放弃" : `本群正在扫雷（${room.player.name}），等这盘结束再开吧`)
      return true
    }
    const arg = (e.msg.match(START_RE)?.[1] || "").trim()
    let level = LEVEL_NAMES.find(l => arg.includes(l)) || ENGLISH_LEVEL[arg.toLowerCase()]
    let size
    if (/自定义|custom/i.test(arg)) {
      const nums = (arg.match(/\d+/g) || []).map(Number)
      if (nums.length !== 3) {
        await e.reply("自定义格式：#扫雷 自定义 行数 列数 雷数，例如 #扫雷 自定义 10 20 30")
        return true
      }
      const [rows, cols, mines] = nums
      const maxRows = Math.min(26, Number(c.maxRows) || 20)
      const maxCols = Math.min(99, Number(c.maxCols) || 30)
      const maxMines = Math.floor(rows * cols * (Number(c.maxDensity) || 0.3))
      if (rows < 5 || rows > maxRows || cols < 5 || cols > maxCols) {
        await e.reply(`大小超出范围：行 5–${maxRows}，列 5–${maxCols}`)
        return true
      }
      if (mines < 1 || mines > maxMines) {
        await e.reply(`雷数超出范围：1–${maxMines}（最多为格子数的 ${Math.round((Number(c.maxDensity) || 0.3) * 100)}%）`)
        return true
      }
      level = "自定义"
      size = { rows, cols, mines }
    }
    if (!level) {
      // 官方机器人下先选难度
      const buttons = levelButtons(e, String(e.user_id))
      if (buttons) {
        await e.reply([...at({ isGroup: e.isGroup }, e.user_id), "请选择扫雷难度", buttons])
        return true
      }
      level = LEVEL_NAMES.includes(c.defaultLevel) ? c.defaultLevel : "初级"
    }
    size ||= LEVELS[level]
    const newRoom = store.set(new Room({
      scope,
      selfId: e.self_id,
      isGroup: !!e.isGroup,
      groupId: e.group_id,
      userId: e.user_id,
      player: { id: String(e.user_id), name: playerName(e) },
      level,
      ...size,
      field: new Minefield(size),
      status: "playing",
      createdAt: Date.now(),
      lastActionAt: Date.now(),
      startAt: 0,
      endAt: 0,
      steps: 0,
      hintsUsed: 0,
      penalty: 0,
      auto: c.autoOpen === true,
    }))
    newRoom.lastEvent = e
    await store.save(newRoom)
    arm(newRoom)
    const center = cellName(Math.floor(size.rows / 2) * size.cols + Math.floor(size.cols / 2), size.cols)
    await e.reply(await boardMessage(e, newRoom, [
      `💣 扫雷 · ${levelLabel(newRoom)}（${size.rows}×${size.cols}，${size.mines} 颗雷）\n`,
      `发送坐标翻开，例如 ${center}；插旗：旗${center}；多格：c1c2c3\n`,
      c.noGuess !== false ? "第一下必定安全，只靠推理就能扫完" : "第一下必定安全",
    ]))
    return true
  }

  /* ---------- 翻开 / 插旗 ---------- */

  async ops(e) {
    const text = String(e.msg || "").trim()
    if (!looksLikeOps(text)) return false
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing" || !isPlayer(room, e)) return false
    const f = room.field
    const res = parseOps(text, f.rows, f.cols, Number(cfg().maxBatch) || 30)
    if (res.error) {
      await e.reply(`❌ ${res.error}`)
      return true
    }
    room.lastEvent = e
    room.lastActionAt = Date.now()
    const notes = []
    const name = i => cellName(i, f.cols)

    if (res.flag) {
      const done = []
      for (const i of res.cells) {
        if (f.open[i]) notes.push(`${name(i)} 已经翻开，不能插旗`)
        else if (f.toggleFlag(i)) done.push(`${f.flag[i] ? "" : "取消"}${name(i)}`)
      }
      room.steps += done.length
      if (done.length) notes.unshift(`🚩 插旗：${done.join("、")}`)
    } else {
      // 第一下：避开这一格放雷
      if (f.status === "ready") {
        const c = cfg()
        const g = generate({ rows: f.rows, cols: f.cols, mines: f.mines, first: res.cells[0], noGuess: c.noGuess !== false, timeBudget: 1000 })
        f.setMines(g.mineList)
        f.status = "playing"
        room.noGuess = g.noGuess
        room.startAt = Date.now()
        if (c.noGuess !== false && !g.noGuess) notes.push("⚠️ 这个大小和雷数生成不了无猜棋盘，本盘可能需要猜")
      }
      let opened = 0
      for (const i of res.cells) {
        if (f.ended) break
        const r = f.reveal(i)
        room.steps++
        opened += r.opened.length
        if (r.note === "flagged") notes.push(`${name(i)} 插了旗，先发 旗${name(i)} 取消`)
        else if (r.note === "flags") notes.push(`${name(i)} 周围的旗数和数字不一致，不能快速翻开`)
      }
      if (room.auto && !f.ended) opened += f.autoChord().opened.length
      if (opened) notes.unshift(`翻开 ${res.cells.map(name).join("、")}，打开了 ${opened} 格`)
    }

    if (f.status === "won") return finish(room, e, [winText(room)], { status: "扫雷成功！", last: res.cells })
    if (f.status === "lost") {
      return finish(room, e, [...at(room, room.player.id), `💥 踩到雷了！${name(f.exploded)} 是雷，用时 ${formatTime(room.elapsed)}`], { status: "踩到雷了！", last: [f.exploded] })
    }
    await store.save(room)
    arm(room)
    await e.reply(await boardMessage(e, room, [notes.join("\n") || "没有变化"], { last: res.cells }))
    return true
  }

  /* ---------- 盘面 / 提示 / 自动 / 结束 ---------- */

  async board(e) {
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room) {
      await e.reply("现在没有进行中的扫雷，发送 #扫雷 开一盘")
      return true
    }
    if (isPlayer(room, e)) room.lastEvent = e
    await e.reply(await boardMessage(e, room, [`${room.player.name} 的扫雷`]))
    return true
  }

  async hint(e) {
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room || !isPlayer(room, e)) {
      await e.reply(room ? "只有正在扫雷的人可以用提示" : "现在没有进行中的扫雷")
      return true
    }
    const c = cfg()
    const limit = Number(c.hintLimit) || 0
    const f = room.field
    if (!limit) {
      await e.reply("提示功能已关闭")
      return true
    }
    if ((room.hintsUsed || 0) >= limit) {
      await e.reply(`本盘 ${limit} 次提示已经用完了`)
      return true
    }
    if (f.status === "ready") {
      await e.reply("第一下必定安全，随便翻开一格吧")
      return true
    }
    // 优先给出能推理出的安全格；推理不出时给一个与已翻开区域相邻的安全格
    let pick = deduce(f).safe.find(i => !f.flag[i])
    if (pick === undefined) {
      const near = []
      for (let i = 0; i < f.total; i++) {
        if (f.open[i] || f.flag[i] || f.mine[i]) continue
        if (f.nb[i].some(j => f.open[j])) near.push(i)
      }
      pick = near[Math.floor(Math.random() * near.length)]
    }
    if (pick === undefined) {
      // 剩下的安全格都被插了旗
      const wrong = []
      for (let i = 0; i < f.total; i++) if (f.flag[i] && !f.mine[i]) wrong.push(i)
      await e.reply(wrong.length ? `有 ${wrong.length} 面旗插错了，剩下的安全格在旗子下面，检查一下吧` : "没有可以提示的格子了")
      return true
    }
    room.hintsUsed = (room.hintsUsed || 0) + 1
    room.penalty = (room.penalty || 0) + (Number(c.hintPenalty) || 0)
    room.lastEvent = e
    room.lastActionAt = Date.now()
    const r = f.reveal(pick)
    room.steps++
    let opened = r.opened.length
    if (room.auto && !f.ended) opened += f.autoChord().opened.length
    const line = `💡 提示：${cellName(pick, f.cols)} 是安全的，打开了 ${opened} 格（已用 ${room.hintsUsed}/${limit} 次${c.hintPenalty ? `，计时 +${c.hintPenalty} 秒` : ""}）`
    if (f.status === "won") return finish(room, e, [line, "\n", winText(room)], { status: "扫雷成功！", last: [pick] })
    if (f.status === "lost") return finish(room, e, [line, "\n💥 踩到雷了！"], { status: "踩到雷了！", last: [f.exploded] })
    await store.save(room)
    arm(room)
    await e.reply(await boardMessage(e, room, [line], { last: [pick] }))
    return true
  }

  async auto(e) {
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room || !isPlayer(room, e)) {
      await e.reply(room ? "只有正在扫雷的人可以切换自动翻开" : "现在没有进行中的扫雷")
      return true
    }
    const arg = (e.msg.match(/(开|关|on|off)\s*$/i)?.[1] || "").toLowerCase()
    room.auto = arg ? arg === "开" || arg === "on" : !room.auto
    room.lastEvent = e
    room.lastActionAt = Date.now()
    const f = room.field
    let line = `自动翻开：${room.auto ? "开（数字周围旗数对得上时自动展开）" : "关"}`
    if (room.auto && f.status === "playing") {
      const opened = f.autoChord().opened.length
      if (opened) line += `\n自动打开了 ${opened} 格`
      if (f.status === "won") return finish(room, e, [line, "\n", winText(room)], { status: "扫雷成功！" })
      if (f.status === "lost") return finish(room, e, [line, `\n💥 旗插错了，${cellName(f.exploded, f.cols)} 是雷`], { status: "踩到雷了！", last: [f.exploded] })
    }
    await store.save(room)
    arm(room)
    await e.reply(await boardMessage(e, room, [line]))
    return true
  }

  async end(e) {
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room) {
      await e.reply("现在没有进行中的扫雷")
      return true
    }
    if (!isPlayer(room, e) && !isAdmin(e)) {
      await e.reply("只有正在扫雷的人、群管理或主人可以结束")
      return true
    }
    room.field.giveUp()
    return finish(room, e, [`已结束 ${room.player.name} 的扫雷，雷的位置如下`], { status: "已结束" })
  }
}
