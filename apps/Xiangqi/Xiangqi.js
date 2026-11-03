import { plugin, segment, Config, makeButtons, playerName, isAdmin } from "../../components/index.js"
import { RoomStore } from "../../components/Room.js"
import { runEngine } from "../../components/AI.js"
import { screenshot } from "../../components/Render.js"
import { XiangqiGame, RESULT_REASON } from "../../games/xiangqi/Game.js"
import { RED, BLACK, iccsToMove } from "../../games/xiangqi/Board.js"
import { looksLikeMove, sampleMoves } from "../../games/xiangqi/Notation.js"
import { renderHtml, renderText } from "../../games/xiangqi/Render.js"
import { LEVEL_NAMES } from "../../games/xiangqi/Engine.js"

/* ================= 玩法 =================
 * 双人（群聊）：#发起象棋 [红/黑] → 群友 #加入象棋 → 开局（不指定颜色时随机分配红黑），红方先走
 * 人机（群聊/私聊）：#人机象棋 [入门/简单/普通/困难] [红/黑]
 * 走棋：轮到的一方直接发送 炮二平五 / 马8进7 / 前车进一 / h2e2
 * 对局中：#棋盘 #悔棋 #求和 #认输，#结束象棋 由发起人、群管理或主人强制结束
 * 英文指令：#Chinese_Chess create|join|ai|board|undo|draw|resign|end|help
 */

export const GAME_ID = "Chinese_Chess"
const GAME_NAME = "中国象棋"
const G = "(?:象棋|Chinese_?Chess)"
const reg = source => new RegExp(source, "i")

const store = new RoomStore(GAME_ID)
const PIECE_NAME = {
  [RED]: ["", "帅", "仕", "相", "马", "车", "炮", "兵"],
  [BLACK]: ["", "将", "士", "象", "马", "车", "炮", "卒"],
}
const sideName = side => (side === RED ? "红方" : "黑方")
const cfg = () => Config.xiangqi || {}

/* ================= 房间 ================= */

class Room {
  constructor(data) {
    Object.assign(this, data)
    this.busy = false
    this.lastEvent = null
  }

  /** 参与这局的真人 */
  members() {
    const ids = []
    if (this.creator) ids.push(String(this.creator.id))
    for (const p of Object.values(this.players || {})) if (p && !p.ai) ids.push(String(p.id))
    return [...new Set(ids)]
  }

  player(side) {
    return side === RED ? this.players.red : this.players.black
  }

  playerSide(id) {
    id = String(id)
    if (!this.players) return 0
    if (!this.players.red.ai && String(this.players.red.id) === id) return RED
    if (!this.players.black.ai && String(this.players.black.id) === id) return BLACK
    return 0
  }

  get aiSide() {
    if (this.mode !== "ai") return 0
    return this.players.red.ai ? RED : BLACK
  }

  serialize() {
    const { busy, lastEvent, game, ...rest } = this
    return { ...rest, game: game?.toJSON() }
  }

  static from(data) {
    return new Room({ ...data, game: data.game ? XiangqiGame.fromJSON(data.game) : null })
  }
}

/** 当前会话的对局；foreign 表示对局属于另一个在线的 Bot（多 Bot 同群时只由开局的 Bot 处理） */
function context(e) {
  const scope = e.isGroup ? `group:${e.group_id}` : `private:${e.user_id}`
  const room = store.get(scope)
  let foreign = false
  if (room && e.self_id && String(room.selfId) !== String(e.self_id)) {
    if (global.Bot?.[room.selfId]) foreign = true
    else room.selfId = e.self_id // 原 Bot 已下线，由当前 Bot 接管
  }
  return { scope, room, foreign }
}

/* ================= 消息 ================= */

const at = (room, id) => (room.isGroup ? [segment.at(id), " "] : [])

function gameButtons(e, room) {
  const ids = room.members()
  return makeButtons(e, [[
    { text: "悔棋", cmd: "#悔棋", permission: ids },
    { text: "求和", cmd: "#求和", permission: ids },
    { text: "认输", cmd: "#认输", permission: ids },
    { text: "棋盘", cmd: "#棋盘" },
  ]])
}

function menuButtons(e) {
  return makeButtons(e, [
    [
      { text: "发起对局", cmd: "#发起象棋" },
      { text: "加入对局", cmd: "#加入象棋" },
      { text: "人机对战", cmd: "#人机象棋" },
    ],
    LEVEL_NAMES.map(level => ({ text: `人机·${level}`, cmd: `#人机象棋 ${level}` })),
  ])
}

function shouldFlip(room) {
  if (room.mode === "ai") return room.aiSide === RED
  return !!cfg().flipForBlack && room.game.side === BLACK && !room.game.result
}

/** 轮到谁走 */
function turnLine(room) {
  const side = room.game.side
  const p = room.player(side)
  if (p.ai) return [`轮到 ${p.name} 走棋`]
  const limit = Number(cfg().moveTimeout) || 0
  return [...at(room, p.id), `轮到你走棋（${sideName(side)}）${limit ? `，限时 ${limit} 秒` : ""}`]
}

function moveLine(room, rec, side) {
  const p = room.player(side)
  let text = `${sideName(side)} ${p.name}：${rec.cn}`
  if (rec.captured) text += `（吃${PIECE_NAME[-side][Math.abs(rec.captured)]}）`
  if (rec.check && !room.game.result) text += " 将军！"
  return text + "\n"
}

/** 棋盘图 + 文字 + 按钮 */
async function boardMessage(e, room, parts = [], { status } = {}) {
  const game = room.game
  const flip = shouldFlip(room)
  if (status === undefined) status = game.inCheck && !game.result ? "将军！" : ""
  const title = room.mode === "ai" ? `${GAME_NAME} · 人机对战` : GAME_NAME
  const img = await screenshot(renderHtml(game, {
    red: room.players.red.name,
    black: room.players.black.name,
    title,
    status,
    flip,
  }), `xiangqi-${room.scope}`)
  const msg = []
  if (img) msg.push(img)
  else if (cfg().textFallback !== false && Config.render?.textFallback !== false) msg.push(`${renderText(game, flip)}\n`)
  msg.push(...parts)
  const buttons = room.status === "playing"
    ? gameButtons(e, room)
    : makeButtons(e, [[{ text: "再来一局", cmd: "#发起象棋" }, { text: "人机对战", cmd: "#人机象棋" }]])
  if (buttons) msg.push(buttons)
  return msg
}

/** 发送：优先回复触发事件（官方机器人的被动回复），没有事件时主动发送 */
async function send(room, e, msg) {
  try {
    if (e?.reply) return await e.reply(msg)
  } catch (err) {
    logger.error(`[Chess-Plugin] 回复失败：${err.message}`)
  }
  try {
    const bot = global.Bot?.[room.selfId] || global.Bot
    const target = room.isGroup ? bot?.pickGroup?.(room.groupId) : bot?.pickFriend?.(room.userId)
    return await target?.sendMsg?.(msg)
  } catch (err) {
    logger.error(`[Chess-Plugin] 主动发送失败：${err.message}`)
  }
}

function resultText(room) {
  const { winner, reason } = room.game.result
  const why = reason === "perpetual" ? "长将判负" : RESULT_REASON[reason] || reason
  const rounds = `共 ${Math.ceil(room.game.moveCount / 2)} 回合`
  if (!winner) return `🤝 和棋（${why}），${rounds}`
  const p = room.player(winner)
  if (room.mode === "ai") {
    return p.ai ? `${p.name} 获胜（${why}），${rounds}，再接再厉！` : `🎉 恭喜你战胜了 ${room.player(-winner).name}！（${why}），${rounds}`
  }
  return `🏆 ${sideName(winner)} ${p.name} 获胜（${why}），${rounds}`
}

function resultStatus(room) {
  const { winner, reason } = room.game.result
  if (!winner) return "和棋"
  return `${reason === "checkmate" ? "绝杀！" : ""}${winner === RED ? "红胜" : "黑胜"}`
}

/** 结束对局并公布结果 */
async function finish(room, e, lines = []) {
  room.status = "ended"
  await store.remove(room.scope)
  const msg = await boardMessage(e, room, [...lines, resultText(room)], { status: resultStatus(room) })
  await send(room, e, msg)
  return true
}

/* ================= 计时 ================= */

function isCurrent(room) {
  return store.get(room.scope) === room
}

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
  await send(room, room.lastEvent, `⌛ ${room.creator.name} 发起的象棋对局无人应战，已自动取消`)
}

async function onWarn(room) {
  if (!isCurrent(room) || room.status !== "playing" || room.busy) return
  const p = room.player(room.game.side)
  if (p.ai) return
  await send(room, room.lastEvent, [...at(room, p.id), `⏰ 还剩 ${cfg().moveWarnBefore} 秒，超时判负`])
}

async function onMoveTimeout(room) {
  if (!isCurrent(room) || room.status !== "playing") return
  const game = room.game
  const side = game.side
  const p = room.player(side)
  if (p.ai) return
  game.end(-side, "timeout")
  await finish(room, room.lastEvent, [`⌛ ${sideName(side)} ${p.name} 超时未走棋\n`])
}

/* ================= AI ================= */

/** AI 走一步，返回走子记录；对局在思考期间结束或变化时返回 null */
async function aiPlay(room) {
  const game = room.game
  const count = game.moveCount
  let res
  try {
    res = await runEngine("think", { fen: game.startFen, moves: game.records.map(r => r.iccs), level: room.aiLevel })
  } catch (err) {
    logger.error(`[Chess-Plugin] AI 思考出错：${err.message}`)
  }
  if (!isCurrent(room) || room.status !== "playing" || game.moveCount !== count || game.result) return null
  const legal = game.legalMoves()
  let move = res ? iccsToMove(res.iccs) : -1
  if (!legal.includes(move)) move = legal[0]
  return game.play(move)
}

/* ================= 重启恢复 ================= */

let restored = false
async function restore() {
  if (restored) return
  restored = true
  const list = await store.loadAll()
  let count = 0
  for (const data of list) {
    try {
      const room = Room.from(data)
      if (room.status === "ended" || room.game?.result) {
        await store.remove(room.scope)
        continue
      }
      // Bot 停机期间不计时
      if (room.status === "waiting") room.createdAt = Date.now()
      if (room.status === "playing") room.turnStartAt = Date.now()
      store.set(room)
      arm(room)
      count++
      if (room.status === "playing" && room.player(room.game.side).ai) resumeAi(room)
    } catch (err) {
      logger.error(`[Chess-Plugin] 恢复对局失败：${err.message}`)
      await store.remove(data.scope)
    }
  }
  if (count) logger.mark(`[Chess-Plugin] 已恢复 ${count} 局象棋对局`)
}

/** 重启前 AI 正在思考的对局：补走一步并主动发送 */
async function resumeAi(room) {
  room.busy = true
  let rec
  try {
    rec = await aiPlay(room)
  } finally {
    room.busy = false
  }
  if (!rec) return
  if (room.game.result) return finish(room, null, [moveLine(room, rec, room.aiSide)])
  room.turnStartAt = Date.now()
  await store.save(room)
  arm(room)
  await send(room, null, await boardMessage(null, room, ["对局已恢复\n", moveLine(room, rec, room.aiSide), ...turnLine(room)]))
}

/* ================= 指令 ================= */

export class Xiangqi extends plugin {
  constructor() {
    super({
      name: "Chess-象棋",
      dsc: "中国象棋：双人对战 / 人机对战",
      event: "message",
      priority: 100,
      rule: [
        { reg: reg(`^#?${G}\\s*(帮助|help)?$`), fnc: "help" },
        { reg: reg(`^#?(?:(?:发起|创建)${G}|${G}\\s*(?:create|new))(.*)$`), fnc: "create" },
        { reg: reg(`^#?(?:(?:加入|应战)${G}|${G}\\s*join)$`), fnc: "join" },
        { reg: reg(`^#?(?:人机${G}|${G}\\s*ai)(.*)$`), fnc: "ai" },
        { reg: reg(`^#?(?:(?:结束|取消)${G}|${G}\\s*end)$`), fnc: "end" },
        { reg: reg(`^#?(?:(?:象棋)?棋盘|${G}\\s*board)$`), fnc: "board" },
        { reg: reg(`^#?(?:悔棋|${G}\\s*undo)$`), fnc: "undo" },
        { reg: /^#?(同意|拒绝)悔棋$/, fnc: "answerUndo" },
        { reg: reg(`^#?(?:求和|提和|${G}\\s*draw)$`), fnc: "draw" },
        { reg: /^#?(同意|拒绝)(求和|和棋)$/, fnc: "answerDraw" },
        { reg: reg(`^#?(?:认输|投降|${G}\\s*resign)$`), fnc: "resign" },
        { reg: /^\s*#?\s*(?:走\s*)?\S{4,7}\s*$/, fnc: "move", log: false },
      ],
    })
  }

  async init() {
    await restore()
  }

  /* ---------- 帮助 ---------- */

  async help(e) {
    const c = cfg()
    const text = [
      `【${GAME_NAME} Chinese_Chess】`,
      "",
      "双人对战（群聊）",
      "  #发起象棋 [红/黑]　发起对局；不指定颜色时，开局随机分配红黑",
      "  #加入象棋　加入对局，加入后立即开始，红方先走",
      "",
      "人机对战（群聊、私聊）",
      `  #人机象棋 [难度] [红/黑]　难度：${LEVEL_NAMES.join(" / ")}，默认${c.defaultAiLevel || "普通"}；默认执红先走`,
      "",
      "走棋（轮到你时直接发送）",
      "  炮二平五、马8进7、前车进一，或坐标 h2e2",
      "  中文数字、阿拉伯数字都能识别；棋盘四周印有纵线编号和坐标",
      "",
      "对局中",
      "  #棋盘　#悔棋　#求和　#认输",
      "  #同意悔棋 / #拒绝悔棋　#同意求和 / #拒绝求和",
      "  #结束象棋　发起人、群管理或主人强制结束",
      "",
      `每步限时 ${c.moveTimeout || 120} 秒，超时判负；长将判负，其他重复局面判和`,
      "English: #Chinese_Chess create | join | ai | board | undo | draw | resign | end",
    ].join("\n")
    const buttons = menuButtons(e)
    await e.reply(buttons ? [text, buttons] : text)
    return true
  }

  /* ---------- 发起 / 加入 ---------- */

  async create(e) {
    if (!e.isGroup) {
      await e.reply("双人对战请在群里发起；私聊可以发送 #人机象棋 和我下棋")
      return true
    }
    const { scope, room, foreign } = context(e)
    if (foreign) return false
    if (room) {
      await e.reply(room.status === "waiting"
        ? [`本群已有 ${room.creator.name} 发起的对局，发送 #加入象棋 应战`, makeButtons(e, [[{ text: "加入对局", cmd: "#加入象棋" }]])].filter(Boolean)
        : "本群正在对局中，请等这局结束")
      return true
    }
    if (store.findByUser(e.user_id)) {
      await e.reply("你还有一局象棋没下完（可以 #认输 或请管理 #结束象棋）")
      return true
    }
    const arg = (e.msg.match(reg(`^#?(?:(?:发起|创建)${G}|${G}\\s*(?:create|new))(.*)$`))?.[1] || "").trim()
    const prefer = /红|red/i.test(arg) ? RED : /黑|black/i.test(arg) ? BLACK : 0
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
      `♟️ ${creator.name} 发起了一局中国象棋${prefer ? `（执${sideName(prefer)}）` : "（红黑随机）"}\n`,
      `发送 #加入象棋 应战，${minutes} 分钟内有效`,
    ]
    const buttons = makeButtons(e, [[
      { text: "加入对局", cmd: "#加入象棋", style: 1 },
      { text: "取消对局", cmd: "#取消象棋", permission: creator.id },
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
      const buttons = makeButtons(e, [[{ text: "发起对局", cmd: "#发起象棋" }, { text: "人机对战", cmd: "#人机象棋" }]])
      await e.reply(["本群还没有人发起对局，发送 #发起象棋 创建", buttons].filter(Boolean))
      return true
    }
    if (room.status !== "waiting") {
      await e.reply("本群正在对局中，请等这局结束")
      return true
    }
    const uid = String(e.user_id)
    if (room.creator.id === uid) {
      await e.reply("不能和自己对战哦，等其他群友加入，或发送 #人机象棋 和我下棋")
      return true
    }
    if (store.findByUser(uid)) {
      await e.reply("你还有一局象棋没下完")
      return true
    }
    const joiner = { id: uid, name: playerName(e) }
    const creatorSide = room.prefer || (Math.random() < 0.5 ? RED : BLACK)
    room.players = creatorSide === RED ? { red: room.creator, black: joiner } : { red: joiner, black: room.creator }
    room.status = "playing"
    room.game = new XiangqiGame({ naturalLimit: Number(cfg().naturalLimit) || 0 })
    room.turnStartAt = Date.now()
    room.lastEvent = e
    await store.save(room)
    arm(room)
    const { red, black } = room.players
    await e.reply(await boardMessage(e, room, [
      `对局开始！${room.prefer ? "" : "（随机分配红黑）"}\n`,
      "红方：", ...at(room, red.id), `${red.name}\n`,
      "黑方：", ...at(room, black.id), `${black.name}\n`,
      ...turnLine(room),
    ]))
    return true
  }

  /* ---------- 人机 ---------- */

  async ai(e) {
    const c = cfg()
    if (!e.isGroup && c.allowPrivate === false) {
      await e.reply("私聊人机对战已关闭，请在群里发送 #人机象棋")
      return true
    }
    const { scope, room, foreign } = context(e)
    if (foreign) return false
    if (room) {
      await e.reply(room.status === "waiting" ? "本群已有人发起对局，发送 #加入象棋 应战" : "这里正在对局中，请等这局结束")
      return true
    }
    if (store.findByUser(e.user_id)) {
      await e.reply("你还有一局象棋没下完")
      return true
    }
    const arg = (e.msg.match(reg(`^#?(?:人机${G}|${G}\\s*ai)(.*)$`))?.[1] || "").trim()
    const english = { beginner: "入门", easy: "简单", normal: "普通", hard: "困难" }
    const level = LEVEL_NAMES.find(l => arg.includes(l))
      || english[Object.keys(english).find(k => new RegExp(k, "i").test(arg))]
      || (LEVEL_NAMES.includes(c.defaultAiLevel) ? c.defaultAiLevel : "普通")
    const humanSide = /黑|black/i.test(arg) ? BLACK : RED
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
      players: humanSide === RED ? { red: human, black: bot } : { red: bot, black: human },
      game: new XiangqiGame({ naturalLimit: Number(c.naturalLimit) || 0 }),
      turnStartAt: Date.now(),
      undoUsed: 0,
    }))
    newRoom.lastEvent = e
    const lines = [`人机对战开始！你执${sideName(humanSide)}，难度：${level}\n`]
    if (humanSide === BLACK) {
      newRoom.busy = true
      try {
        const rec = await aiPlay(newRoom)
        if (rec) lines.push(moveLine(newRoom, rec, RED))
      } finally {
        newRoom.busy = false
      }
      if (!isCurrent(newRoom)) return true
    }
    newRoom.turnStartAt = Date.now()
    await store.save(newRoom)
    arm(newRoom)
    await e.reply(await boardMessage(e, newRoom, [...lines, ...turnLine(newRoom)]))
    return true
  }

  /* ---------- 走棋 ---------- */

  async move(e) {
    const text = String(e.msg || "").trim().replace(/^#?\s*(?:走\s*)?/, "")
    if (!looksLikeMove(text)) return false
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
      await e.reply("还没轮到你，等对方走完再下")
      return true
    }
    const res = game.parse(text)
    if (res.error) {
      await e.reply(`❌ ${res.error}\n可以这样走：${sampleMoves(game.pos, 4).join("、")}`)
      return true
    }
    room.lastEvent = e
    room.undoRequest = null
    room.drawOffer = null
    const lines = [moveLine(room, game.play(res.move), side)]
    if (game.result) return finish(room, e, lines)

    if (room.mode === "ai") {
      room.busy = true
      let rec
      try {
        rec = await aiPlay(room)
      } finally {
        room.busy = false
      }
      if (!isCurrent(room) || room.status !== "playing") return true
      if (rec) lines.push(moveLine(room, rec, -side))
      if (game.result) return finish(room, e, lines)
    }

    room.turnStartAt = Date.now()
    await store.save(room)
    arm(room)
    await e.reply(await boardMessage(e, room, [...lines, ...turnLine(room)]))
    return true
  }

  /* ---------- 查看棋盘 ---------- */

  async board(e) {
    const { room, foreign } = context(e)
    if (!room || foreign) return false
    if (room.status === "waiting") {
      await e.reply(`${room.creator.name} 发起的对局正在等待对手，发送 #加入象棋 应战`)
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
    // 轮到自己时对方已经应着，退两步；自己刚走完则退一步
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
      // AI 执红时保留它的第一步
      if (game.moveCount - n < (room.aiSide === RED ? 1 : 0)) {
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
    const opponent = room.player(-side)
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
        const res = await runEngine("eval", { fen: game.startFen, moves: game.records.map(r => r.iccs) })
        score = game.side === room.aiSide ? res : -res
      } catch {}
      if (!isCurrent(room) || room.status !== "playing") return true
      // AI 局面落后，或下了很久仍然均势时接受
      if (score <= -150 || (game.moveCount >= 100 && Math.abs(score) <= 40)) {
        game.end(0, "agreed")
        return finish(room, e, [`${ai.name} 接受了求和\n`])
      }
      await e.reply(`${ai.name} 拒绝了求和：${score > 150 ? "这局我还占优呢" : "局面还很复杂，继续下吧"}`)
      return true
    }

    const timeout = (Number(cfg().requestTimeout) || 60) * 1000
    const offer = room.drawOffer
    if (offer && Date.now() - offer.at < timeout && offer.from !== String(e.user_id)) {
      // 对方已经提和，视为同意
      game.end(0, "agreed")
      return finish(room, e)
    }
    const opponent = room.player(-side)
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
    room.game.end(-side, "resign")
    return finish(room, e, [`🏳️ ${sideName(side)} ${room.player(side).name} 认输\n`])
  }

  async end(e) {
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room) {
      await e.reply("这里没有进行中的象棋对局")
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
    await e.reply(room.game ? "对局已强制结束，不计胜负" : "已取消对局")
    return true
  }
}
