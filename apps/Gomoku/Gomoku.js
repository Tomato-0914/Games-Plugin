import { plugin, segment, Config, isQQBot, makeButtons, playerName, isAdmin } from "../../components/index.js"
import { RoomStore } from "../../components/Room.js"
import { runEngine } from "../../components/AI.js"
import { screenshot, fontUrl } from "../../components/Render.js"
import { helpMessage } from "../../components/Help.js"
import { GomokuGame, RESULT_REASON, BLACK, WHITE, parsePoint, pointName } from "../../games/gomoku/Board.js"
import { renderHtml, renderText } from "../../games/gomoku/Render.js"
import { LEVEL_NAMES } from "../../games/gomoku/AI.js"

/* ================= 玩法 =================
 * 双人（群聊）：#发起五子棋 [黑/白] → 群友 #加入五子棋 → 开局（不指定颜色时随机），黑方先下
 * 人机（群聊/私聊）：#人机五子棋 [简单/普通/困难] [黑/白]
 * 落子：轮到的一方直接发送坐标 H8（列字母 A–O + 行号 1–15），也可以写 8H、下H8
 * 黑方禁手：三三、四四（五连优先）；长连默认算赢
 * 对局中：#棋盘 #悔棋 #求和 #认输（双人需对方同意），#结束五子棋
 * 英文指令：#Gomoku create|join|ai|board|undo|draw|resign|end|help
 */

export const GAME_ID = "Gomoku"
const GAME_NAME = "五子棋"
const G = "(?:五子棋|Gomoku)"
const reg = source => new RegExp(source, "i")
// 字母放宽到 A–Z：轮到的玩家写错列号时能收到“超出棋盘”的提示
const MOVE_RE = /^\s*#?\s*(?:下|落子?)?\s*([a-zA-Z]\s*\d{1,2}|\d{1,2}\s*[a-zA-Z])\s*$/

const store = new RoomStore(GAME_ID)
const sideName = side => (side === BLACK ? "黑方" : "白方")
const other = side => 3 - side
const cfg = () => Config.all.gomoku || {}
const rules = () => {
  const c = cfg()
  return { forbidden: c.forbidden !== false, overline: c.overline === "forbidden" ? "forbidden" : "win", forbiddenLoses: c.forbiddenLoses === true }
}

/* ================= 房间 ================= */

class Room {
  constructor(data) {
    Object.assign(this, data)
    this.busy = false
    this.lastEvent = null
  }

  members() {
    const ids = []
    if (this.creator) ids.push(String(this.creator.id))
    for (const p of Object.values(this.players || {})) if (p && !p.ai) ids.push(String(p.id))
    return [...new Set(ids)]
  }

  player(side) {
    return side === BLACK ? this.players.black : this.players.white
  }

  playerSide(id) {
    id = String(id)
    if (!this.players) return 0
    if (!this.players.black.ai && String(this.players.black.id) === id) return BLACK
    if (!this.players.white.ai && String(this.players.white.id) === id) return WHITE
    return 0
  }

  get aiSide() {
    if (this.mode !== "ai") return 0
    return this.players.black.ai ? BLACK : WHITE
  }

  serialize() {
    const { busy, lastEvent, game, ...rest } = this
    return { ...rest, game: game?.toJSON() }
  }

  static from(data) {
    return new Room({ ...data, game: data.game ? GomokuGame.fromJSON(data.game) : null })
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

/* ================= 消息 ================= */

const at = (room, id) => (room.isGroup ? [segment.at(id), " "] : [])

function gameButtons(e, room) {
  const ids = room.members()
  return makeButtons(e, [
    [{ text: "落子", input: "下", permission: ids, style: 1 }],
    [
      { text: "悔棋", cmd: "#悔棋", permission: ids },
      { text: "求和", cmd: "#求和", permission: ids },
      { text: "认输", cmd: "#认输", permission: ids },
    ],
  ])
}

function menuButtons(e) {
  return makeButtons(e, [[
    { text: "发起对局", cmd: "#发起五子棋" },
    { text: "加入对局", cmd: "#加入五子棋" },
    { text: "人机对战", cmd: "#人机五子棋" },
  ]])
}

function turnLine(room) {
  const side = room.game.side
  const p = room.player(side)
  if (p.ai) return [`轮到 ${p.name} 落子`]
  const limit = Number(cfg().moveTimeout) || 0
  return [...at(room, p.id), `轮到你落子（${sideName(side)}）${limit ? `，限时 ${limit} 秒` : ""}`]
}

const moveLine = (room, side, i) => `${sideName(side)} ${room.player(side).name}：${pointName(i)}\n`

async function boardMessage(e, room, parts = [], { status } = {}) {
  const game = room.game
  const forbidden = cfg().showForbidden !== false ? game.forbiddenPoints() : []
  if (status === undefined) status = forbidden.length ? "× 为黑方禁手点" : ""
  const img = await screenshot(renderHtml(game, {
    black: room.players.black.name,
    white: room.players.white.name,
    title: room.mode === "ai" ? `${GAME_NAME} · 人机对战` : GAME_NAME,
    status,
    forbidden,
    fontUrl,
  }), `gomoku-${room.scope}`)
  const msg = []
  if (img) msg.push(img)
  else if (Config.render?.textFallback !== false) msg.push(`${renderText(game, { forbidden })}\n`)
  msg.push(...parts)
  const buttons = room.status === "playing"
    ? gameButtons(e, room)
    : makeButtons(e, [[{ text: "再来一局", cmd: "#发起五子棋" }, { text: "人机对战", cmd: "#人机五子棋" }]])
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

function resultText(room) {
  const { winner, reason, detail } = room.game.result
  const why = reason === "forbidden" ? `黑方禁手（${detail}）判负` : RESULT_REASON[reason] || reason
  const count = `共 ${room.game.moveCount} 手`
  if (!winner) return `🤝 和棋（${why}），${count}`
  const p = room.player(winner)
  if (room.mode === "ai") {
    return p.ai ? `${p.name} 获胜（${why}），${count}，再接再厉！` : `🎉 恭喜你战胜了 ${room.player(other(winner)).name}！（${why}），${count}`
  }
  return `🏆 ${sideName(winner)} ${p.name} 获胜（${why}），${count}`
}

function resultStatus(room) {
  const { winner } = room.game.result
  return !winner ? "和棋" : winner === BLACK ? "黑胜" : "白胜"
}

async function finish(room, e, lines = []) {
  room.status = "ended"
  await store.remove(room.scope)
  await send(room, e, await boardMessage(e, room, [...lines, resultText(room)], { status: resultStatus(room) }))
  return true
}

/* ================= 计时 ================= */

const isCurrent = room => store.get(room.scope) === room

function arm(room) {
  const c = cfg()
  const now = Date.now()
  store.clearTimers(room.scope)
  if (room.status === "waiting") {
    store.setTimer(room.scope, "join", room.createdAt + (Number(c.joinTimeout) || 300) * 1000 - now, () => onJoinTimeout(room))
    return
  }
  if (room.status !== "playing") return
  const timeout = Number(c.moveTimeout) || 0
  if (timeout <= 0 || room.player(room.game.side).ai) return
  const deadline = room.turnStartAt + timeout * 1000
  store.setTimer(room.scope, "move", deadline - now, () => onMoveTimeout(room))
  const warn = Number(c.moveWarnBefore) || 0
  if (warn > 0 && warn < timeout) store.setTimer(room.scope, "warn", deadline - warn * 1000 - now, () => onWarn(room))
}

async function onJoinTimeout(room) {
  if (!isCurrent(room) || room.status !== "waiting") return
  await store.remove(room.scope)
  await send(room, room.lastEvent, `⌛ ${room.creator.name} 发起的五子棋对局无人应战，已自动取消`)
}

async function onWarn(room) {
  if (!isCurrent(room) || room.status !== "playing" || room.busy) return
  const p = room.player(room.game.side)
  if (p.ai) return
  await send(room, room.lastEvent, [...at(room, p.id), `⏰ 还剩 ${cfg().moveWarnBefore} 秒，超时判负`])
}

async function onMoveTimeout(room) {
  if (!isCurrent(room) || room.status !== "playing") return
  const side = room.game.side
  const p = room.player(side)
  if (p.ai) return
  room.game.end(other(side), "timeout")
  await finish(room, room.lastEvent, [`⌛ ${sideName(side)} ${p.name} 超时未落子\n`])
}

/* ================= AI ================= */

/** AI 落一子，返回落点；对局在思考期间变化时返回 -1 */
async function aiPlay(room) {
  const game = room.game
  const count = game.moveCount
  let res
  try {
    res = await runEngine("think", { moves: game.moves, rules: game.rules, level: room.aiLevel }, "gomoku")
  } catch (err) {
    logger.error(`[Games-Plugin] 五子棋 AI 出错：${err.message}`)
  }
  if (!isCurrent(room) || room.status !== "playing" || game.moveCount !== count || game.result) return -1
  let move = res?.move ?? -1
  if (move < 0 || game.play(move).error) {
    // 兜底：下在第一个合法的空点
    move = -1
    for (let i = 0; i < game.cells.length && move < 0; i++) if (!game.cells[i] && game.play(i).ok) move = i
  }
  return move
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
      if (room.status === "ended" || room.game?.result) {
        await store.remove(room.scope)
        continue
      }
      if (room.status === "waiting") room.createdAt = Date.now()
      if (room.status === "playing") room.turnStartAt = Date.now()
      store.set(room)
      arm(room)
      count++
      if (room.status === "playing" && room.player(room.game.side).ai) resumeAi(room)
    } catch (err) {
      logger.error(`[Games-Plugin] 恢复五子棋失败：${err.message}`)
      await store.remove(data.scope)
    }
  }
  if (count) logger.mark(`[Games-Plugin] 已恢复 ${count} 局五子棋`)
}

async function resumeAi(room) {
  room.busy = true
  let move
  try {
    move = await aiPlay(room)
  } finally {
    room.busy = false
  }
  if (move < 0) return
  const line = moveLine(room, room.aiSide, move)
  if (room.game.result) return finish(room, null, [line])
  room.turnStartAt = Date.now()
  await store.save(room)
  arm(room)
  await send(room, null, await boardMessage(null, room, ["对局已恢复\n", line, ...turnLine(room)]))
}

/* ================= 指令 ================= */

const CREATE_RE = reg(`^#?(?:(?:发起|创建)${G}|${G}\\s*(?:create|new))(.*)$`)
const AI_RE = reg(`^#?(?:人机${G}|${G}\\s*ai)(.*)$`)

export class Gomoku extends plugin {
  constructor() {
    super({
      name: "Games-五子棋",
      dsc: "五子棋：双人对战 / 人机对战",
      event: "message",
      priority: 105,
      rule: [
        { reg: reg(`^#?${G}\\s*(帮助|help)?$`), fnc: "help" },
        { reg: CREATE_RE, fnc: "create" },
        { reg: reg(`^#?(?:(?:加入|应战)${G}|${G}\\s*join)$`), fnc: "join" },
        { reg: AI_RE, fnc: "ai" },
        { reg: reg(`^#?(?:(?:结束|取消)${G}|${G}\\s*end)$`), fnc: "end" },
        { reg: reg(`^#?(?:(?:五子棋)?棋盘|${G}\\s*board)$`), fnc: "board" },
        { reg: reg(`^#?(?:悔棋|${G}\\s*undo)$`), fnc: "undo" },
        { reg: /^#?(同意|拒绝)悔棋$/, fnc: "answerUndo" },
        { reg: reg(`^#?(?:求和|提和|${G}\\s*draw)$`), fnc: "draw" },
        { reg: /^#?(同意|拒绝)(求和|和棋)$/, fnc: "answerDraw" },
        { reg: reg(`^#?(?:认输|投降|${G}\\s*resign)$`), fnc: "resign" },
        { reg: /^#?(同意|拒绝)认输$/, fnc: "answerResign" },
        { reg: MOVE_RE, fnc: "move", log: false },
      ],
    })
  }

  async init() {
    await restore()
  }

  /* ---------- 帮助 ---------- */

  async help(e) {
    const c = cfg()
    const r = rules()
    const limit = Number(c.moveTimeout) || 0
    const notes = []
    if (r.forbidden) notes.push(`黑方禁手：三三、四四（同时成五时不算）；${r.forbiddenLoses ? "下在禁手点判负" : "禁手点不能落子"}`)
    notes.push(r.overline === "forbidden" ? "长连（六子以上）：黑方禁手，白方算赢" : "长连（六子以上）也算赢")
    if (limit) notes.push(`每步限时 ${limit} 秒，超时判负；黑方回合时棋盘上用 × 标出禁手点`)
    const data = {
      title: GAME_NAME,
      subtitle: "黑先 · 五子连珠为胜",
      piece: "棋",
      color: "black",
      badge: GAME_ID,
      sections: [
        {
          title: "双人对战",
          tag: "群聊",
          piece: "黑",
          color: "black",
          items: [
            { cmd: "#发起五子棋", desc: "发起对局，开局时随机分配黑白" },
            { cmd: "#发起五子棋 黑", desc: "指定自己执黑（或“白”）" },
            { cmd: "#加入五子棋", desc: "加入对局，加入后立即开始，黑方先下" },
          ],
        },
        {
          title: "人机对战",
          tag: "群聊 · 私聊",
          piece: "白",
          items: [
            { cmd: "#人机五子棋", desc: isQQBot(e) ? "选择难度后开始，默认执黑先下" : `默认${c.defaultAiLevel || "普通"}难度，执黑先下` },
            { cmd: "#人机五子棋 困难 白", desc: `难度：${LEVEL_NAMES.join(" / ")}，可执白后下` },
          ],
        },
        {
          title: "落子",
          tag: "轮到你时直接发送",
          piece: "子",
          color: "black",
          items: [
            { cmd: "H8", desc: "列字母 A–O + 行号 1–15，棋盘四周印有坐标" },
            { cmd: "8H / 下H8", desc: "这些写法也可以" },
          ],
        },
        {
          title: "对局中",
          piece: "局",
          items: [
            { cmd: "#棋盘", desc: "重新发送棋盘" },
            { cmd: "#悔棋", desc: `双人需对方同意，人机每局 ${Number(c.aiUndoLimit) || 0} 次` },
            { cmd: "#求和", desc: "双人需对方同意，人机根据局面决定" },
            { cmd: "#认输", desc: "双人需对方同意，人机直接认输" },
            { cmd: "#同意 / #拒绝 + 悔棋/求和/认输", desc: "回应对方的请求" },
            { cmd: "#结束五子棋", desc: "发起人 / 群管理 / 主人强制结束" },
          ],
          notes,
        },
      ],
      footer: "English: #Gomoku create | join | ai | board | undo | draw | resign | end",
    }
    const msg = [await helpMessage(data, "help-gomoku")]
    const buttons = menuButtons(e)
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  /* ---------- 发起 / 加入 ---------- */

  async create(e) {
    if (!e.isGroup) {
      await e.reply("双人对战请在群里发起；私聊可以发送 #人机五子棋 和我下棋")
      return true
    }
    const { scope, room, foreign } = context(e)
    if (foreign) return false
    if (room) {
      await e.reply(room.status === "waiting"
        ? [`本群已有 ${room.creator.name} 发起的五子棋，发送 #加入五子棋 应战`, makeButtons(e, [[{ text: "加入对局", cmd: "#加入五子棋" }]])].filter(Boolean)
        : "本群正在下五子棋，请等这局结束")
      return true
    }
    if (store.findByUser(e.user_id)) {
      await e.reply("你还有一局五子棋没下完（可以 #认输 或请管理 #结束五子棋）")
      return true
    }
    const arg = (e.msg.match(CREATE_RE)?.[1] || "").trim()
    const prefer = /黑|black/i.test(arg) ? BLACK : /白|white/i.test(arg) ? WHITE : 0
    const creator = { id: String(e.user_id), name: playerName(e) }
    const newRoom = store.set(new Room({
      scope,
      selfId: e.self_id,
      isGroup: true,
      groupId: e.group_id,
      status: "waiting",
      mode: "pvp",
      creator,
      prefer,
      createdAt: Date.now(),
    }))
    newRoom.lastEvent = e
    await store.save(newRoom)
    arm(newRoom)
    const minutes = Math.round((Number(cfg().joinTimeout) || 300) / 60)
    const msg = [
      `⚫ ${creator.name} 发起了一局五子棋${prefer ? `（执${sideName(prefer)}）` : "（黑白随机）"}\n`,
      `发送 #加入五子棋 应战，${minutes} 分钟内有效`,
    ]
    const buttons = makeButtons(e, [[
      { text: "加入对局", cmd: "#加入五子棋", style: 1 },
      { text: "取消对局", cmd: "#取消五子棋", permission: creator.id },
    ]])
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  async join(e) {
    if (!e.isGroup) {
      await e.reply("双人对战请在群里进行")
      return true
    }
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room) {
      const buttons = makeButtons(e, [[{ text: "发起对局", cmd: "#发起五子棋" }, { text: "人机对战", cmd: "#人机五子棋" }]])
      await e.reply(["本群还没有人发起五子棋，发送 #发起五子棋 创建", buttons].filter(Boolean))
      return true
    }
    if (room.status !== "waiting") {
      await e.reply("本群正在下五子棋，请等这局结束")
      return true
    }
    const uid = String(e.user_id)
    if (room.creator.id === uid) {
      await e.reply("不能和自己对战哦，等其他群友加入，或发送 #人机五子棋 和我下棋")
      return true
    }
    if (store.findByUser(uid)) {
      await e.reply("你还有一局五子棋没下完")
      return true
    }
    const joiner = { id: uid, name: playerName(e) }
    const creatorSide = room.prefer || (Math.random() < 0.5 ? BLACK : WHITE)
    room.players = creatorSide === BLACK ? { black: room.creator, white: joiner } : { black: joiner, white: room.creator }
    room.status = "playing"
    room.game = new GomokuGame({ rules: rules() })
    room.turnStartAt = Date.now()
    room.lastEvent = e
    await store.save(room)
    arm(room)
    const { black, white } = room.players
    await e.reply(await boardMessage(e, room, [
      `对局开始！${room.prefer ? "" : "（随机分配黑白）"}\n`,
      "黑方：", ...at(room, black.id), `${black.name}\n`,
      "白方：", ...at(room, white.id), `${white.name}\n`,
      ...turnLine(room),
    ]))
    return true
  }

  /* ---------- 人机 ---------- */

  async ai(e) {
    const c = cfg()
    if (!e.isGroup && c.allowPrivate === false) {
      await e.reply("私聊人机对战已关闭，请在群里发送 #人机五子棋")
      return true
    }
    const { scope, room, foreign } = context(e)
    if (foreign) return false
    if (room) {
      await e.reply(room.status === "waiting" ? "本群已有人发起五子棋，发送 #加入五子棋 应战" : "这里正在下五子棋，请等这局结束")
      return true
    }
    if (store.findByUser(e.user_id)) {
      await e.reply("你还有一局五子棋没下完")
      return true
    }
    const arg = (e.msg.match(AI_RE)?.[1] || "").trim()
    const english = { easy: "简单", normal: "普通", hard: "困难" }
    const chosen = LEVEL_NAMES.find(l => arg.includes(l)) || english[Object.keys(english).find(k => new RegExp(k, "i").test(arg))]
    const humanSide = /白|white/i.test(arg) ? WHITE : BLACK
    if (!chosen) {
      const color = humanSide === WHITE ? " 白" : ""
      const buttons = makeButtons(e, [LEVEL_NAMES.map(l => ({ text: l, cmd: `#人机五子棋 ${l}${color}`, permission: String(e.user_id) }))])
      if (buttons) {
        await e.reply([...at({ isGroup: e.isGroup }, e.user_id), `请选择人机难度（执${sideName(humanSide)}）`, buttons])
        return true
      }
    }
    const level = chosen || (LEVEL_NAMES.includes(c.defaultAiLevel) ? c.defaultAiLevel : "普通")
    const human = { id: String(e.user_id), name: playerName(e) }
    const bot = { ai: true, level, name: `${e.bot?.nickname || "Bot"}（${level}）` }
    const newRoom = store.set(new Room({
      scope,
      selfId: e.self_id,
      isGroup: !!e.isGroup,
      groupId: e.group_id,
      userId: e.user_id,
      status: "playing",
      mode: "ai",
      aiLevel: level,
      creator: human,
      players: humanSide === BLACK ? { black: human, white: bot } : { black: bot, white: human },
      game: new GomokuGame({ rules: rules() }),
      turnStartAt: Date.now(),
      undoUsed: 0,
    }))
    newRoom.lastEvent = e
    const lines = [`人机对战开始！你执${sideName(humanSide)}，难度：${level}\n`]
    if (humanSide === WHITE) {
      newRoom.busy = true
      let move
      try {
        move = await aiPlay(newRoom)
      } finally {
        newRoom.busy = false
      }
      if (!isCurrent(newRoom)) return true
      if (move >= 0) lines.push(moveLine(newRoom, BLACK, move))
    }
    newRoom.turnStartAt = Date.now()
    await store.save(newRoom)
    arm(newRoom)
    await e.reply(await boardMessage(e, newRoom, [...lines, ...turnLine(newRoom)]))
    return true
  }

  /* ---------- 落子 ---------- */

  async move(e) {
    const m = MOVE_RE.exec(String(e.msg || ""))
    if (!m) return false
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing") return false
    const side = room.playerSide(e.user_id)
    if (!side) return false
    const game = room.game
    if (room.busy) {
      await e.reply("我正在思考，请稍等…")
      return true
    }
    if (side !== game.side) {
      await e.reply("还没轮到你，等对方下完再落子")
      return true
    }
    const point = parsePoint(m[1])
    if (point < 0) {
      await e.reply("❌ 坐标超出棋盘：列 A–O，行 1–15，例如 H8")
      return true
    }
    const res = game.play(point)
    if (res.error) {
      await e.reply(`❌ ${res.error}`)
      return true
    }
    room.lastEvent = e
    room.undoRequest = null
    room.drawOffer = null
    room.resignRequest = null
    const lines = [moveLine(room, side, point)]
    if (game.result) return finish(room, e, lines)

    if (room.mode === "ai") {
      room.busy = true
      let move
      try {
        move = await aiPlay(room)
      } finally {
        room.busy = false
      }
      if (!isCurrent(room) || room.status !== "playing") return true
      if (move >= 0) lines.push(moveLine(room, other(side), move))
      if (game.result) return finish(room, e, lines)
    }

    room.turnStartAt = Date.now()
    await store.save(room)
    arm(room)
    await e.reply(await boardMessage(e, room, [...lines, ...turnLine(room)]))
    return true
  }

  /* ---------- 棋盘 ---------- */

  async board(e) {
    const { room, foreign } = context(e)
    if (!room || foreign) return false
    if (room.status === "waiting") {
      await e.reply(`${room.creator.name} 发起的五子棋正在等待对手，发送 #加入五子棋 应战`)
      return true
    }
    room.lastEvent = e
    await e.reply(await boardMessage(e, room, turnLine(room)))
    return true
  }

  /* ---------- 悔棋 ---------- */

  async undo(e) {
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing") return false
    const side = room.playerSide(e.user_id)
    if (!side) return false
    if (room.busy) {
      await e.reply("我正在思考，请稍等…")
      return true
    }
    const game = room.game
    const n = game.side === side ? 2 : 1
    if (game.moveCount < n) {
      await e.reply("还没有可以悔的棋")
      return true
    }

    if (room.mode === "ai") {
      const limit = Number(cfg().aiUndoLimit) || 0
      if ((room.undoUsed || 0) >= limit) {
        await e.reply(limit ? `本局 ${limit} 次悔棋机会已经用完了` : "人机对战不允许悔棋")
        return true
      }
      // AI 执黑时保留它的第一手
      if (game.moveCount - n < (room.aiSide === BLACK ? 1 : 0)) {
        await e.reply("还没有可以悔的棋")
        return true
      }
      game.undo(n)
      room.undoUsed = (room.undoUsed || 0) + 1
      room.lastEvent = e
      room.turnStartAt = Date.now()
      await store.save(room)
      arm(room)
      await e.reply(await boardMessage(e, room, [`↩️ 已悔棋（本局还剩 ${limit - room.undoUsed} 次）\n`, ...turnLine(room)]))
      return true
    }

    const timeout = (Number(cfg().requestTimeout) || 60) * 1000
    if (room.undoRequest && Date.now() - room.undoRequest.at < timeout) {
      await e.reply("已经有一个悔棋请求在等待回应")
      return true
    }
    const opponent = room.player(other(side))
    room.undoRequest = { from: String(e.user_id), n, at: Date.now(), moveCount: game.moveCount }
    room.lastEvent = e
    const msg = [...at(room, opponent.id), `${room.player(side).name} 请求悔棋，是否同意？\n发送 #同意悔棋 或 #拒绝悔棋（${timeout / 1000} 秒内有效）`]
    const buttons = makeButtons(e, [[
      { text: "同意悔棋", cmd: "#同意悔棋", permission: opponent.id },
      { text: "拒绝悔棋", cmd: "#拒绝悔棋", permission: opponent.id },
    ]])
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  async answerUndo(e) {
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing" || room.mode !== "pvp") return false
    if (!room.playerSide(e.user_id)) return false
    const req = room.undoRequest
    const timeout = (Number(cfg().requestTimeout) || 60) * 1000
    if (!req || Date.now() - req.at > timeout) {
      room.undoRequest = null
      await e.reply("没有待回应的悔棋请求")
      return true
    }
    if (req.from === String(e.user_id)) {
      await e.reply("要等对方同意哦")
      return true
    }
    room.undoRequest = null
    if (/拒绝/.test(e.msg)) {
      await e.reply("对方拒绝了悔棋，继续下吧")
      return true
    }
    const game = room.game
    if (game.moveCount !== req.moveCount) {
      await e.reply("棋局已经变化，悔棋请求失效")
      return true
    }
    game.undo(req.n)
    room.lastEvent = e
    room.turnStartAt = Date.now()
    await store.save(room)
    arm(room)
    await e.reply(await boardMessage(e, room, ["↩️ 对方同意悔棋\n", ...turnLine(room)]))
    return true
  }

  /* ---------- 求和 ---------- */

  async draw(e) {
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing") return false
    const side = room.playerSide(e.user_id)
    if (!side) return false
    const game = room.game
    room.lastEvent = e

    if (room.mode === "ai") {
      if (room.busy) {
        await e.reply("我正在思考，请稍等…")
        return true
      }
      const ai = room.player(room.aiSide)
      let score = 0
      try {
        const res = await runEngine("eval", { moves: game.moves, rules: game.rules }, "gomoku")
        score = game.side === room.aiSide ? res : -res
      } catch {}
      if (!isCurrent(room) || room.status !== "playing") return true
      // AI 明显落后，或棋盘快下满时接受
      if (score <= -2000 || game.moveCount >= 180) {
        game.end(0, "agreed")
        return finish(room, e, [`${ai.name} 接受了求和\n`])
      }
      await e.reply(`${ai.name} 拒绝了求和：${score > 2000 ? "这局我还占优呢" : "局面还很复杂，继续下吧"}`)
      return true
    }

    const timeout = (Number(cfg().requestTimeout) || 60) * 1000
    const offer = room.drawOffer
    if (offer && Date.now() - offer.at < timeout && offer.from !== String(e.user_id)) {
      game.end(0, "agreed")
      return finish(room, e)
    }
    const opponent = room.player(other(side))
    room.drawOffer = { from: String(e.user_id), at: Date.now() }
    const msg = [...at(room, opponent.id), `${room.player(side).name} 提出和棋，是否同意？\n发送 #同意求和 或 #拒绝求和（${timeout / 1000} 秒内有效）`]
    const buttons = makeButtons(e, [[
      { text: "同意求和", cmd: "#同意求和", permission: opponent.id },
      { text: "拒绝求和", cmd: "#拒绝求和", permission: opponent.id },
    ]])
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  async answerDraw(e) {
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing" || room.mode !== "pvp") return false
    if (!room.playerSide(e.user_id)) return false
    const offer = room.drawOffer
    const timeout = (Number(cfg().requestTimeout) || 60) * 1000
    if (!offer || Date.now() - offer.at > timeout) {
      room.drawOffer = null
      await e.reply("没有待回应的和棋请求")
      return true
    }
    if (offer.from === String(e.user_id)) {
      await e.reply("要等对方同意哦")
      return true
    }
    room.drawOffer = null
    if (/拒绝/.test(e.msg)) {
      await e.reply("对方拒绝了和棋，继续下吧")
      return true
    }
    room.lastEvent = e
    room.game.end(0, "agreed")
    return finish(room, e)
  }

  /* ---------- 认输 / 结束 ---------- */

  async resign(e) {
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing") return false
    const side = room.playerSide(e.user_id)
    if (!side) return false
    room.lastEvent = e
    if (room.mode === "ai") {
      room.game.end(other(side), "resign")
      return finish(room, e, [`🏳️ ${sideName(side)} ${room.player(side).name} 认输\n`])
    }
    const timeout = (Number(cfg().requestTimeout) || 60) * 1000
    if (room.resignRequest && Date.now() - room.resignRequest.at < timeout) {
      await e.reply(room.resignRequest.from === String(e.user_id) ? "已经提出认输，等待对方回应" : "对方已经提出认输，发送 #同意认输 或 #拒绝认输")
      return true
    }
    const opponent = room.player(other(side))
    room.resignRequest = { from: String(e.user_id), at: Date.now() }
    const msg = [...at(room, opponent.id), `${room.player(side).name} 请求认输，是否同意？\n发送 #同意认输 或 #拒绝认输（${timeout / 1000} 秒内有效）`]
    const buttons = makeButtons(e, [[
      { text: "同意认输", cmd: "#同意认输", permission: opponent.id },
      { text: "拒绝认输", cmd: "#拒绝认输", permission: opponent.id },
    ]])
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  async answerResign(e) {
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing" || room.mode !== "pvp") return false
    if (!room.playerSide(e.user_id)) return false
    const req = room.resignRequest
    const timeout = (Number(cfg().requestTimeout) || 60) * 1000
    if (!req || Date.now() - req.at > timeout) {
      room.resignRequest = null
      await e.reply("没有待回应的认输请求")
      return true
    }
    if (req.from === String(e.user_id)) {
      await e.reply("要等对方同意哦")
      return true
    }
    room.resignRequest = null
    if (/拒绝/.test(e.msg)) {
      await e.reply("对方拒绝了认输，继续下吧")
      return true
    }
    room.lastEvent = e
    const side = room.playerSide(req.from)
    room.game.end(other(side), "resign")
    return finish(room, e, [`🏳️ ${sideName(side)} ${room.player(side).name} 认输\n`])
  }

  async end(e) {
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room) {
      await e.reply("这里没有进行中的五子棋")
      return true
    }
    const uid = String(e.user_id)
    const allowed = isAdmin(e)
      || (room.status === "waiting" && room.creator.id === uid)
      || (room.mode === "ai" && room.playerSide(uid))
    if (!allowed) {
      await e.reply(room.status === "waiting" ? "只有发起人、群管理或主人可以取消对局" : "对局中请使用 #认输；强制结束需要群管理或主人")
      return true
    }
    await store.remove(room.scope)
    room.status = "ended"
    await e.reply(room.game ? "五子棋已强制结束，不计胜负" : "已取消五子棋对局")
    return true
  }
}
