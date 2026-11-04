import { plugin, segment, Config, isQQBot, makeButtons, playerName, isAdmin } from "../../components/index.js"
import { RoomStore } from "../../components/Room.js"
import { screenshot, fontUrl } from "../../components/Render.js"
import { helpMessage } from "../../components/Help.js"
import { FlyingGame, chooseMove } from "../../games/flying/Game.js"
import { COLOR_NAMES, FINISH } from "../../games/flying/Board.js"
import { renderHtml, renderText } from "../../games/flying/Render.js"

/* ================= 玩法 =================
 * #发起飞行棋 → 其他人 #加入飞行棋（最多 4 人）→ 发起人 #开始飞行棋 [补机器人]
 * #人机飞行棋 [1-3]：和 1–3 个机器人玩（群聊、私聊）
 * 轮到你：#掷骰子 → 有多架飞机可走时发 1–4 选择；只有一种走法时自动走
 * 每次操作 60 秒，超时由机器人代走；连续 3 次超时转为托管，发任意飞行棋指令接回
 * #退出飞行棋：交给机器人托管；#结束飞行棋：发起人 / 群管理 / 主人
 * 排出第 1、2、3 名，最后一名为输
 */

export const GAME_ID = "FlyingChess"
const GAME_NAME = "飞行棋"
const reg = source => new RegExp(source, "i")
const F = "(?:飞行棋|FlyingChess)"
const store = new RoomStore(GAME_ID)
const cfg = () => Config.all.flying || {}
const colorName = c => COLOR_NAMES[c]

/** 几个人时用哪些颜色：两人坐对角 */
const seatColors = n => (n <= 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3])

/* ================= 房间 ================= */

class Room {
  constructor(data) {
    Object.assign(this, data)
    this.lastEvent = null
  }

  members() {
    return this.seats.filter(s => !s.bot).map(s => String(s.id))
  }

  seatOf(id) {
    return this.seats.find(s => !s.bot && String(s.id) === String(id))
  }

  seatByColor(c) {
    return this.seats.find(s => s.color === c)
  }

  get current() {
    return this.seatByColor(this.game.color)
  }

  serialize() {
    const { lastEvent, game, ...rest } = this
    return { ...rest, game: game?.toJSON() }
  }

  static from(data) {
    return new Room({ ...data, game: data.game ? FlyingGame.fromJSON(data.game) : null })
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

const at = (room, id) => (room.isGroup ? [segment.at(id), " "] : [])
const controlledByBot = seat => seat.bot || seat.hosted
const seatTag = s => (s.bot ? "机器人" : s.left ? "已退出" : s.hosted ? "托管" : "")

/* ================= 消息 ================= */

function players(room) {
  return room.seats.map(s => ({ color: s.color, name: s.name, tag: seatTag(s) }))
}

/** 一步棋的文字 */
function describe(room, color, roll, plane, info) {
  const seat = room.seatByColor(color)
  let text = `${colorName(color)} ${seat.name} 掷出 ${roll}：`
  if (info.takeoff) text += `${plane + 1}号起飞`
  else {
    text += `${plane + 1}号前进`
    if (info.steps.includes("bounce")) text += "（到终点后反弹）"
    if (info.jumped) text += "，跳到同色格"
    if (info.flew) text += "，沿捷径飞行"
  }
  if (info.hits.length) text += `，撞回 ${info.hits.map(h => `${colorName(h.color)}${h.plane + 1}号`).join("、")}`
  if (info.finish) text += "，到达终点！"
  if (info.rank) text += `🎉 ${colorName(color)}方四架飞机全部到达，第 ${info.rank} 名`
  if (info.again) text += "（掷出 6，再掷一次）"
  return text
}

/**
 * 机器人（含托管）连续行动，直到轮到真人或对局结束
 * @param {number} [maxTurns] 最多执行的“掷骰”次数
 */
function runBots(room, lines, { force = false } = {}) {
  const game = room.game
  for (let guard = 0; guard < 300 && !game.result; guard++) {
    const seat = room.current
    if (!force && !controlledByBot(seat)) break
    const color = game.color
    const { roll, voided } = game.rollDice()
    room.lastRoll = roll
    if (voided) {
      lines.push(`${colorName(color)} ${seat.name} 连续三次掷出 6，本回合作废`)
      if (force) break
      continue
    }
    const plane = chooseMove(game)
    if (plane < 0) {
      const { again } = game.skip()
      lines.push(`${colorName(color)} ${seat.name} 掷出 ${roll}：没有可以走的飞机${again ? "（掷出 6，再掷一次）" : ""}`)
      if (force && !again) break
      continue
    }
    const info = game.move(plane)
    lines.push(describe(room, color, roll, plane, info))
    if (force && !info.again) break
  }
}

function rollButtons(e, room) {
  const seat = room.current
  return makeButtons(e, [[{ text: "掷骰子", cmd: "#掷骰子", permission: String(seat.id), style: 1 }]])
}

function choiceButtons(e, room) {
  const seat = room.current
  return makeButtons(e, [room.game.distinctMoves().map(k => ({ text: `${k + 1}号`, cmd: `${k + 1}`, permission: String(seat.id) }))])
}

function endButtons(e, room) {
  const again = room.mode === "ai" ? `#人机飞行棋 ${room.seats.filter(s => s.bot).length}` : "#发起飞行棋"
  return makeButtons(e, [[{ text: "飞行棋帮助", cmd: "#飞行棋帮助" }, { text: "再来一局", cmd: again }]])
}

/** 只保留最近几条行动，避免刷屏 */
function trimLines(lines, max = 8) {
  if (lines.length <= max) return lines
  return [`……（省略 ${lines.length - max} 步）`, ...lines.slice(-max)]
}

/**
 * @param lines 行动记录（过长时只保留最近几条）
 * @param notes 提示（超时、托管等），总是完整显示
 */
async function boardMessage(e, room, lines = [], { choosing = false, notes = [] } = {}) {
  const game = room.game
  const shown = trimLines(lines)
  const last = shown[shown.length - 1] || ""
  const img = await screenshot(renderHtml(game, {
    players: players(room),
    title: room.mode === "ai" ? `${GAME_NAME} · 人机对战` : GAME_NAME,
    last: choosing ? `${colorName(game.color)} 掷出 ${game.roll}：选择要走的飞机` : last.replace(/^.*?掷出/, "掷出"),
    roll: choosing ? game.roll : room.lastRoll || 0,
    status: game.result ? "对局结束" : "",
    highlight: choosing ? game.movablePlanes() : [],
    fontUrl,
  }), `flying-${room.scope}`)
  const msg = []
  if (img) msg.push(img)
  else if (Config.render?.textFallback !== false) msg.push(`${renderText(game, players(room))}\n`)
  if (notes.length) msg.push(notes.join("\n") + "\n")
  if (shown.length) msg.push(shown.join("\n") + "\n")
  let buttons = null
  if (game.result) {
    msg.push(rankText(room))
    buttons = endButtons(e, room)
  } else {
    const seat = room.current
    const limit = Number(cfg().actionTimeout) || 0
    if (choosing) {
      msg.push(...at(room, seat.id), `掷出 ${game.roll}，选择要走的飞机：${game.distinctMoves().map(k => `${k + 1}号`).join(" / ")}（发送数字）`)
      buttons = choiceButtons(e, room)
    } else {
      msg.push(...at(room, seat.id), `轮到你（${colorName(seat.color)}）掷骰子，发送 #掷骰子${limit ? `，${limit} 秒内` : ""}`)
      buttons = rollButtons(e, room)
    }
  }
  if (buttons) msg.push(buttons)
  return msg
}

function rankText(room) {
  const ranks = room.game.result.ranks
  return ranks.map((c, i) => {
    const s = room.seatByColor(c)
    const last = i === ranks.length - 1
    return `${last ? "💔 最后一名" : ["🥇 第 1 名", "🥈 第 2 名", "🥉 第 3 名"][i]}：${colorName(c)} ${s.name}${last ? "（输）" : ""}`
  }).join("\n")
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

/** 行动完成后：机器人继续，然后保存、计时、发消息 */
async function afterAction(room, e, lines, notes = []) {
  runBots(room, lines)
  if (room.game.result) {
    room.status = "ended"
    await store.remove(room.scope)
    await send(room, e, await boardMessage(e, room, lines, { notes }))
    return true
  }
  room.turnStartAt = Date.now()
  await store.save(room)
  arm(room)
  await send(room, e, await boardMessage(e, room, lines, { choosing: room.game.roll > 0, notes }))
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
  const timeout = Number(c.actionTimeout) || 0
  if (timeout > 0) store.setTimer(room.scope, "action", room.turnStartAt + timeout * 1000 - now, () => onActionTimeout(room))
}

async function onJoinTimeout(room) {
  if (!isCurrent(room) || room.status !== "waiting") return
  await store.remove(room.scope)
  await send(room, room.lastEvent, `⌛ ${room.creator.name} 发起的飞行棋人数不够，已自动取消`)
}

/** 超时：机器人代走这一回合；连续多次超时转为托管 */
async function onActionTimeout(room) {
  if (!isCurrent(room) || room.status !== "playing") return
  const seat = room.current
  if (controlledByBot(seat)) return
  seat.timeouts = (seat.timeouts || 0) + 1
  const hostAfter = Number(cfg().hostAfter) || 3
  const notes = [`⌛ ${colorName(seat.color)} ${seat.name} 超时，由机器人代走`]
  const lines = []
  if (seat.timeouts >= hostAfter) {
    seat.hosted = true
    notes.push(`${seat.name} 连续 ${seat.timeouts} 次超时，已转为机器人托管（发送任意飞行棋指令即可接回）`)
  }
  const game = room.game
  if (game.roll) {
    // 已经掷过、正在选飞机：代选
    const color = game.color
    const roll = game.roll
    const plane = chooseMove(game)
    const info = game.move(plane)
    lines.push(describe(room, color, roll, plane, info))
    if (info.again && !seat.hosted) runBots(room, lines, { force: true })
  } else {
    runBots(room, lines, { force: true })
  }
  await afterAction(room, room.lastEvent, lines, notes)
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
    } catch (err) {
      logger.error(`[Games-Plugin] 恢复飞行棋失败：${err.message}`)
      await store.remove(data.scope)
    }
  }
  if (count) logger.mark(`[Games-Plugin] 已恢复 ${count} 局飞行棋`)
}

/* ================= 指令 ================= */

export class FlyingChess extends plugin {
  constructor() {
    super({
      name: "Games-飞行棋",
      dsc: "飞行棋：2–4 人 / 人机",
      event: "message",
      priority: 107,
      rule: [
        { reg: reg(`^#?${F}\\s*(帮助|help)?$`), fnc: "help" },
        { reg: reg(`^#?(?:(?:发起|创建)飞行棋|FlyingChess\\s*(?:create|new))$`), fnc: "create" },
        { reg: reg(`^#?(?:加入飞行棋|FlyingChess\\s*join)$`), fnc: "join" },
        { reg: reg(`^#?(?:开始飞行棋|FlyingChess\\s*start)\\s*(补机器人|bots?)?$`), fnc: "start" },
        { reg: reg(`^#?(?:人机飞行棋|FlyingChess\\s*ai)\\s*([1-3])?$`), fnc: "ai" },
        { reg: reg(`^#?(?:(?:飞行棋)?棋盘|FlyingChess\\s*board)$`), fnc: "board" },
        { reg: reg(`^#?(?:退出飞行棋|FlyingChess\\s*quit)$`), fnc: "quit" },
        { reg: reg(`^#?(?:(?:结束|取消)飞行棋|FlyingChess\\s*end)$`), fnc: "end" },
        { reg: reg(`^#?\\s*(?:掷骰子|投骰子|掷|骰子|🎲|roll|FlyingChess\\s*roll)$`), fnc: "roll" },
        { reg: /^#?\s*([1-4])\s*号?(?:飞机)?$/, fnc: "choose", log: false },
      ],
    })
  }

  async init() {
    await restore()
  }

  /* ---------- 帮助 ---------- */

  async help(e) {
    const c = cfg()
    const limit = Number(c.actionTimeout) || 0
    const data = {
      title: GAME_NAME,
      subtitle: "2–4 人 · 掷骰子起飞 · 排出名次",
      piece: "飞",
      badge: GAME_ID,
      sections: [
        {
          title: "规则",
          piece: "规",
          items: [
            { cmd: "起飞", desc: "掷出 6 才能让一架飞机起飞；掷出 6 可以再掷，连续三次 6 本回合作废" },
            { cmd: "跳子", desc: "停在自己颜色的格子，跳到前面下一个同色格" },
            { cmd: "飞棋", desc: "停在虚线箭头起点（自己颜色），沿虚线飞到对面；一次最多跳一次、飞一次" },
            { cmd: "撞子", desc: "停在对方飞机的格子，把那一格的对方飞机全部撞回停机坪" },
            { cmd: "叠子", desc: "自己的飞机可以停在同一格；对方叠子不挡路" },
            { cmd: "终点", desc: "必须正好走到终点，多出的步数往回退" },
            { cmd: "名次", desc: "四架飞机最先全部到达终点为第 1 名，依次排出名次，最后一名为输" },
          ],
        },
        {
          title: "开局",
          piece: "局",
          color: "black",
          items: [
            { cmd: "#发起飞行棋", desc: "发起对局（群聊），其他人 #加入飞行棋，最多 4 人" },
            { cmd: "#开始飞行棋", desc: "发起人开始，至少 2 人；#开始飞行棋 补机器人 把空位补成机器人" },
            { cmd: "#人机飞行棋 3", desc: "和 1–3 个机器人玩（群聊、私聊都可以）" },
          ],
        },
        {
          title: "对局中",
          piece: "骰",
          items: [
            { cmd: "#掷骰子", desc: "轮到你时掷骰子（也可以发 掷）" },
            { cmd: "1 / 2 / 3 / 4", desc: "有多架飞机能走时，选择要走的飞机；只有一种走法时自动走" },
            { cmd: "#飞行棋棋盘", desc: "重新发送棋盘" },
            { cmd: "#退出飞行棋", desc: "交给机器人托管，其他人继续" },
            { cmd: "#结束飞行棋", desc: "发起人 / 群管理 / 主人强制结束" },
          ],
          notes: [
            `${limit ? `每次操作 ${limit} 秒，超时由机器人代走；` : ""}连续 ${Number(c.hostAfter) || 3} 次超时转为托管，发送任意飞行棋指令接回`,
          ],
        },
      ],
      footer: "English: #FlyingChess create | join | start | ai | roll | board | quit | end",
    }
    const msg = [await helpMessage(data, "help-flying")]
    const buttons = makeButtons(e, [[
      { text: "发起对局", cmd: "#发起飞行棋" },
      { text: "加入对局", cmd: "#加入飞行棋" },
      { text: "人机对战", cmd: "#人机飞行棋" },
    ]])
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  /* ---------- 开局 ---------- */

  async create(e) {
    if (!e.isGroup) {
      await e.reply("多人对局请在群里发起；私聊可以发送 #人机飞行棋 和机器人玩")
      return true
    }
    const { scope, room, foreign } = context(e)
    if (foreign) return false
    if (room) {
      await e.reply(room.status === "waiting" ? `本群已有 ${room.creator.name} 发起的飞行棋，发送 #加入飞行棋 参加` : "本群正在玩飞行棋，请等这局结束")
      return true
    }
    if (store.findByUser(e.user_id)) {
      await e.reply("你还有一局飞行棋没结束")
      return true
    }
    const creator = { id: String(e.user_id), name: playerName(e) }
    const newRoom = store.set(new Room({
      scope, selfId: e.self_id, isGroup: true, groupId: e.group_id,
      status: "waiting", mode: "pvp", creator,
      seats: [{ id: creator.id, name: creator.name, color: 0 }],
      createdAt: Date.now(),
    }))
    newRoom.lastEvent = e
    await store.save(newRoom)
    arm(newRoom)
    const minutes = Math.round((Number(cfg().joinTimeout) || 300) / 60)
    const msg = [`✈️ ${creator.name} 发起了一局飞行棋（1/4）\n发送 #加入飞行棋 参加，人到齐后发起人发送 #开始飞行棋（${minutes} 分钟内有效）`]
    const buttons = this.lobbyButtons(e, newRoom)
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  lobbyButtons(e, room) {
    return makeButtons(e, [
      [{ text: "加入对局", cmd: "#加入飞行棋", style: 1 }],
      [
        { text: "开始", cmd: "#开始飞行棋", permission: room.creator.id },
        { text: "补机器人开始", cmd: "#开始飞行棋 补机器人", permission: room.creator.id },
      ],
    ])
  }

  async join(e) {
    if (!e.isGroup) return false
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room) {
      await e.reply("本群还没有人发起飞行棋，发送 #发起飞行棋 创建")
      return true
    }
    if (room.status !== "waiting") {
      await e.reply("本群正在玩飞行棋，请等这局结束")
      return true
    }
    if (room.seatOf(e.user_id)) {
      await e.reply("你已经加入了，等发起人开始吧")
      return true
    }
    if (room.seats.length >= 4) {
      await e.reply("人数已满（4 人），等发起人开始吧")
      return true
    }
    if (store.findByUser(e.user_id)) {
      await e.reply("你还有一局飞行棋没结束")
      return true
    }
    room.seats.push({ id: String(e.user_id), name: playerName(e), color: room.seats.length })
    room.lastEvent = e
    await store.save(room)
    const names = room.seats.map(s => s.name).join("、")
    const msg = [`${playerName(e)} 加入了飞行棋（${room.seats.length}/4）：${names}\n`, ...at(room, room.creator.id), "人到齐后发送 #开始飞行棋"]
    const buttons = this.lobbyButtons(e, room)
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  /** 按人数分配颜色并开局 */
  async begin(e, room, botCount) {
    const humans = room.seats.filter(s => !s.bot)
    const total = humans.length + botCount
    const colors = seatColors(total)
    const botName = e.bot?.nickname || "Bot"
    room.seats = colors.map((color, i) => (i < humans.length
      ? { ...humans[i], color, timeouts: 0 }
      : { id: `bot${i}`, name: `${botName}·${colorName(color)}`, color, bot: true }))
    room.status = "playing"
    room.game = new FlyingGame({ colors })
    room.lastEvent = e
    const lines = [`飞行棋开始！${room.seats.map(s => `${colorName(s.color)}：${s.name}`).join("，")}`]
    return afterAction(room, e, lines)
  }

  async start(e) {
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room || room.status !== "waiting") {
      await e.reply(room ? "对局已经开始了" : "本群还没有人发起飞行棋，发送 #发起飞行棋 创建")
      return true
    }
    if (room.creator.id !== String(e.user_id) && !isAdmin(e)) {
      await e.reply("只有发起人、群管理或主人可以开始")
      return true
    }
    const fill = /补机器人|bot/i.test(e.msg)
    const humans = room.seats.length
    if (!fill && humans < 2) {
      await e.reply("至少要 2 人才能开始；也可以发送 #开始飞行棋 补机器人 把空位补成机器人")
      return true
    }
    return this.begin(e, room, fill ? 4 - humans : 0)
  }

  async ai(e) {
    const c = cfg()
    if (!e.isGroup && c.allowPrivate === false) {
      await e.reply("私聊人机已关闭，请在群里发送 #人机飞行棋")
      return true
    }
    const { scope, room, foreign } = context(e)
    if (foreign) return false
    if (room) {
      await e.reply(room.status === "waiting" ? "本群已有人发起飞行棋，发送 #加入飞行棋 参加" : "这里正在玩飞行棋，请等这局结束")
      return true
    }
    if (store.findByUser(e.user_id)) {
      await e.reply("你还有一局飞行棋没结束")
      return true
    }
    const bots = Number(e.msg.match(/([1-3])\s*$/)?.[1]) || 3
    const creator = { id: String(e.user_id), name: playerName(e) }
    const newRoom = store.set(new Room({
      scope, selfId: e.self_id, isGroup: !!e.isGroup, groupId: e.group_id, userId: e.user_id,
      status: "waiting", mode: "ai", creator,
      seats: [{ id: creator.id, name: creator.name, color: 0 }],
      createdAt: Date.now(),
    }))
    return this.begin(e, newRoom, bots)
  }

  /* ---------- 对局中 ---------- */

  /** 玩家发指令时：若在托管中则接回 */
  reclaim(room, seat, lines) {
    if (seat?.hosted && !seat.left) {
      seat.hosted = false
      seat.timeouts = 0
      lines.push(`${seat.name} 已接回操作`)
    }
  }

  async roll(e) {
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing") return false
    const seat = room.seatOf(e.user_id)
    if (!seat) return false
    const lines = []
    const notes = []
    this.reclaim(room, seat, notes)
    const game = room.game
    if (room.current !== seat) {
      if (notes.length) {
        await store.save(room)
        await e.reply(notes.join("\n"))
      } else await e.reply(`还没轮到你，现在是 ${colorName(game.color)} ${room.current.name}`)
      return true
    }
    if (game.roll) {
      await e.reply(`已经掷出 ${game.roll}，请选择飞机：${game.distinctMoves().map(k => `${k + 1}号`).join(" / ")}`)
      return true
    }
    seat.timeouts = 0
    room.lastEvent = e
    const color = game.color
    const { roll, voided } = game.rollDice()
    room.lastRoll = roll
    if (voided) {
      lines.push(`${colorName(color)} ${seat.name} 连续三次掷出 6，本回合作废`)
      return afterAction(room, e, lines, notes)
    }
    const options = game.distinctMoves()
    if (!options.length) {
      const { again } = game.skip()
      lines.push(`${colorName(color)} ${seat.name} 掷出 ${roll}：没有可以走的飞机${again ? "（掷出 6，再掷一次）" : ""}`)
      return afterAction(room, e, lines, notes)
    }
    if (options.length === 1) {
      const info = game.move(options[0])
      lines.push(describe(room, color, roll, options[0], info))
      return afterAction(room, e, lines, notes)
    }
    // 需要选择
    room.turnStartAt = Date.now()
    await store.save(room)
    arm(room)
    await e.reply(await boardMessage(e, room, lines, { choosing: true, notes }))
    return true
  }

  async choose(e) {
    const m = /([1-4])/.exec(e.msg)
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "playing") return false
    const seat = room.seatOf(e.user_id)
    if (!seat || room.current !== seat || !room.game.roll) return false
    const lines = []
    const notes = []
    this.reclaim(room, seat, notes)
    const game = room.game
    const plane = Number(m[1]) - 1
    if (!game.movablePlanes().includes(plane)) {
      await e.reply(`${plane + 1}号飞机现在不能走，可以选：${game.distinctMoves().map(k => `${k + 1}号`).join(" / ")}`)
      return true
    }
    seat.timeouts = 0
    room.lastEvent = e
    const color = game.color
    const roll = game.roll
    room.lastRoll = roll
    const info = game.move(plane)
    lines.push(describe(room, color, roll, plane, info))
    return afterAction(room, e, lines, notes)
  }

  async board(e) {
    const { room, foreign } = context(e)
    if (!room || foreign) return false
    if (room.status === "waiting") {
      await e.reply(`飞行棋等待开始（${room.seats.length}/4）：${room.seats.map(s => s.name).join("、")}`)
      return true
    }
    if (room.seatOf(e.user_id)) room.lastEvent = e
    await e.reply(await boardMessage(e, room, [], { choosing: room.game.roll > 0 }))
    return true
  }

  async quit(e) {
    const { room, foreign } = context(e)
    if (!room || foreign) return false
    const seat = room.seatOf(e.user_id)
    if (!seat) return false
    if (room.status === "waiting") {
      if (room.creator.id === seat.id) {
        await e.reply("发起人退出请发送 #结束飞行棋")
        return true
      }
      room.seats = room.seats.filter(s => s !== seat).map((s, i) => ({ ...s, color: i }))
      await store.save(room)
      await e.reply(`${seat.name} 退出了飞行棋（${room.seats.length}/4）`)
      return true
    }
    seat.hosted = true
    seat.left = true
    room.lastEvent = e
    const lines = [`${colorName(seat.color)} ${seat.name} 退出，飞机交给机器人托管`]
    // 所有真人都不在了：直接结束
    if (room.seats.every(s => controlledByBot(s))) {
      await store.remove(room.scope)
      room.status = "ended"
      await e.reply([...lines, "没有真人玩家了，对局结束"].join("\n"))
      return true
    }
    return afterAction(room, e, lines)
  }

  async end(e) {
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room) {
      await e.reply("这里没有进行中的飞行棋")
      return true
    }
    const uid = String(e.user_id)
    const allowed = isAdmin(e) || room.creator.id === uid
    if (!allowed) {
      await e.reply("只有发起人、群管理或主人可以结束；想离开可以发送 #退出飞行棋")
      return true
    }
    const waiting = room.status === "waiting"
    await store.remove(room.scope)
    room.status = "ended"
    await e.reply(waiting ? "已取消飞行棋" : "飞行棋已结束，不计名次")
    return true
  }
}
