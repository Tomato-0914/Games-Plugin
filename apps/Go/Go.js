import { plugin, segment, Config, isQQBot, makeButtons, playerName, isAdmin } from "../../components/index.js"
import { RoomStore } from "../../components/Room.js"
import { runEngine } from "../../components/AI.js"
import { screenshot, fontUrl } from "../../components/Render.js"
import { helpMessage } from "../../components/Help.js"
import { GoGame, RESULT_REASON, BLACK, WHITE, PASS, YIELD, SIZES, parsePoint, pointName, formatZi } from "../../games/go/Board.js"
import { renderHtml, renderText } from "../../games/go/Render.js"

/* ================= 玩法 =================
 * 双人对战（群聊）：#发起围棋 [9/13/19] [黑/白] → 群友 #加入围棋 → 开局，黑先
 * 落子：轮到的一方直接发送坐标 D4（列字母跳过 I）
 * #停一手：双方连续停一手进入数子，机器人估算死子后双方 #同意数子 / #继续对局
 * #让子：白方在自己第一手之前可以连续让子，最多 5 次（让子局按中国规则贴还）
 * 对局中：#棋盘 #悔棋 #求和 #认输（都需对方同意），#结束围棋
 * 英文指令（需带 #）：#Go create|join|pass|handicap|board|undo|draw|resign|end|help
 */

export const GAME_ID = "Go"
const GAME_NAME = "围棋"
const reg = source => new RegExp(source, "i")
const CN = name => `#?${name}`
const MOVE_RE = /^\s*#?\s*(?:下|落子?)?\s*([a-zA-Z]\s*\d{1,2}|\d{1,2}\s*[a-zA-Z])\s*$/
const CREATE_RE = reg(`^(?:${CN("(?:发起|创建)围棋")}|#Go\\s*(?:create|new))(.*)$`)

const store = new RoomStore(GAME_ID)
const sideName = side => (side === BLACK ? "黑方" : "白方")
const other = side => 3 - side
const cfg = () => Config.all.go || {}
const minutes = sec => (sec >= 60 && sec % 60 === 0 ? `${sec / 60} 分钟` : `${sec} 秒`)

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
    for (const p of Object.values(this.players || {})) if (p) ids.push(String(p.id))
    return [...new Set(ids)]
  }

  player(side) {
    return side === BLACK ? this.players.black : this.players.white
  }

  playerSide(id) {
    id = String(id)
    if (!this.players) return 0
    if (String(this.players.black.id) === id) return BLACK
    if (String(this.players.white.id) === id) return WHITE
    return 0
  }

  serialize() {
    const { busy, lastEvent, game, ...rest } = this
    return { ...rest, game: game?.toJSON() }
  }

  static from(data) {
    return new Room({ ...data, game: data.game ? GoGame.fromJSON(data.game) : null })
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
  const game = room.game
  const row1 = [
    { text: "落子", input: "下", permission: ids, style: 1 },
    { text: "停一手", cmd: "#停一手", permission: ids },
  ]
  if (game.canYield()) row1.push({ text: "让子", cmd: "#让子", permission: room.players.white.id })
  return makeButtons(e, [row1, [
    { text: "悔棋", cmd: "#悔棋", permission: ids },
    { text: "求和", cmd: "#求和", permission: ids },
    { text: "认输", cmd: "#认输", permission: ids },
  ]])
}

function menuButtons(e) {
  return makeButtons(e, [[
    { text: "发起对局", cmd: "#发起围棋" },
    { text: "加入对局", cmd: "#加入围棋" },
  ]])
}

function sizeButtons(e, permission, color = "") {
  return makeButtons(e, [SIZES.map(s => ({ text: `${s} 路`, cmd: `#发起围棋 ${s}${color}`, permission }))])
}

function turnLine(room) {
  const side = room.game.side
  const p = room.player(side)
  const limit = Number(cfg().moveTimeout) || 0
  const tip = room.game.canYield() ? "（白方可以 #让子）" : ""
  return [...at(room, p.id), `轮到你落子（${sideName(side)}）${limit ? `，限时 ${minutes(limit)}` : ""}${tip}`]
}

/** 一手棋的文字说明 */
function describe(room, side, move, captured = 0) {
  const name = room.player(side).name
  if (move === PASS) return `${sideName(side)} ${name}：停一手`
  if (move === YIELD) return `${sideName(side)} ${name}：让子（第 ${room.game.yields} 次）`
  return `${sideName(side)} ${name}：${pointName(move, room.game.size)}${captured ? `（提 ${captured} 子）` : ""}`
}

function lastText(room) {
  const g = room.game
  const n = g.moves.length
  if (!n) return "尚未落子"
  const m = g.moves[n - 1]
  const side = n % 2 === 1 ? BLACK : WHITE
  const word = m === PASS ? "停一手" : m === YIELD ? "让子" : pointName(m, g.size)
  return `上一手　${side === BLACK ? "黑" : "白"}：${word}${m >= 0 && g.lastCaptured.length ? `（提 ${g.lastCaptured.length} 子）` : ""}`
}

function komiText(game) {
  return game.handicap >= 2 ? `让 ${game.handicap} 子，黑贴还 ${formatZi(game.komi)}` : `黑贴 ${formatZi(game.komi)}`
}

function scoreText(score) {
  const diff = Math.abs(score.diff)
  const res = score.winner ? `${score.winner === BLACK ? "黑" : "白"}胜 ${formatZi(diff)}` : "和棋"
  return { line: `黑 ${score.black} 子，白 ${score.white} 子，${score.komiText}`, res }
}

async function boardMessage(e, room, parts = [], { status = "", score = null } = {}) {
  const game = room.game
  const info = {
    black: room.players.black.name,
    white: room.players.white.name,
    title: GAME_NAME,
    status,
    last: score ? scoreText(score).line : lastText(room),
    score,
    fontUrl,
  }
  const img = await screenshot(renderHtml(game, info), `go-${room.scope}`)
  const msg = []
  if (img) msg.push(img)
  else if (Config.render?.textFallback !== false) msg.push(`${renderText(game, { score })}\n`)
  msg.push(...parts)
  let buttons
  if (room.status === "playing") buttons = gameButtons(e, room)
  else if (room.status === "scoring") {
    const ids = room.members()
    buttons = makeButtons(e, [[
      { text: "同意数子", cmd: "#同意数子", permission: ids, style: 1 },
      { text: "继续对局", cmd: "#继续对局", permission: ids },
    ]])
  } else {
    buttons = makeButtons(e, [[{ text: "围棋帮助", cmd: "#围棋帮助" }, { text: "再来一局", cmd: `#发起围棋 ${game.size}` }]])
  }
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
  const { winner, reason } = room.game.result
  const count = `共 ${room.game.stoneMoves} 手`
  if (reason === "score") {
    const s = room.scoreResult
    const { line, res } = scoreText(s)
    if (!winner) return `🤝 ${line}，和棋，${count}`
    return `🏆 ${line}\n${sideName(winner)} ${room.player(winner).name} ${res.slice(1)}，${count}`
  }
  const why = RESULT_REASON[reason] || reason
  if (!winner) return `🤝 和棋（${why}），${count}`
  return `🏆 ${sideName(winner)} ${room.player(winner).name} 获胜（${why}），${count}`
}

function resultStatus(room) {
  const { winner, reason } = room.game.result
  if (reason === "score") return scoreText(room.scoreResult).res
  return !winner ? "和棋" : winner === BLACK ? "黑胜" : "白胜"
}

async function finish(room, e, lines = []) {
  room.status = "ended"
  await store.remove(room.scope)
  const score = room.game.result?.reason === "score" ? room.scoreResult : null
  await send(room, e, await boardMessage(e, room, [...lines, resultText(room)], { status: resultStatus(room), score }))
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
  if (room.status === "scoring") {
    const wait = Number(c.scoreTimeout) || 120
    store.setTimer(room.scope, "score", room.scoringAt + wait * 1000 - now, () => onScoreTimeout(room))
    return
  }
  if (room.status !== "playing") return
  const timeout = Number(c.moveTimeout) || 0
  if (timeout <= 0) return
  const deadline = room.turnStartAt + timeout * 1000
  store.setTimer(room.scope, "move", deadline - now, () => onMoveTimeout(room))
  const warn = Number(c.moveWarnBefore) || 0
  if (warn > 0 && warn < timeout) store.setTimer(room.scope, "warn", deadline - warn * 1000 - now, () => onWarn(room))
}

async function onJoinTimeout(room) {
  if (!isCurrent(room) || room.status !== "waiting") return
  await store.remove(room.scope)
  await send(room, room.lastEvent, `⌛ ${room.creator.name} 发起的围棋对局无人应战，已自动取消`)
}

async function onWarn(room) {
  if (!isCurrent(room) || room.status !== "playing") return
  const p = room.player(room.game.side)
  await send(room, room.lastEvent, [...at(room, p.id), `⏰ 还剩 ${minutes(Number(cfg().moveWarnBefore))}，超时判负`])
}

async function onMoveTimeout(room) {
  if (!isCurrent(room) || room.status !== "playing") return
  const side = room.game.side
  room.game.end(other(side), "timeout")
  await finish(room, room.lastEvent, [`⌛ ${sideName(side)} ${room.player(side).name} 超时未落子\n`])
}

/** 数子确认超时：没人要求继续，按估算结果结束 */
async function onScoreTimeout(room) {
  if (!isCurrent(room) || room.status !== "scoring") return
  const s = room.scoreResult
  room.game.end(s.winner, "score")
  await finish(room, room.lastEvent, ["⌛ 数子确认时间到，按估算结果结束\n"])
}

/* ================= 数子 ================= */

async function startScoring(room, e, lines) {
  room.busy = true
  let s
  try {
    s = await runEngine("score", room.game.toJSON(), "go")
  } catch (err) {
    logger.error(`[Games-Plugin] 围棋数子出错：${err.message}`)
    // 降级：不认定死子，直接按盘面数
    const raw = room.game.score([])
    s = { dead: [], ...raw, owner: [...raw.owner] }
  } finally {
    room.busy = false
  }
  if (!isCurrent(room)) return true
  s.komiText = komiText(room.game)
  room.scoreResult = s
  room.status = "scoring"
  room.scoringAt = Date.now()
  room.agree = {}
  await store.save(room)
  arm(room)
  const { res } = scoreText(s)
  const wait = Number(cfg().scoreTimeout) || 120
  await e.reply(await boardMessage(e, room, [
    ...lines,
    `双方连续停一手，进入数子（半透明的子为估算的死子，小方块为各方的地）\n`,
    `估算结果：${res}\n`,
    `双方发送 #同意数子 按此结果结束；有异议发送 #继续对局 接着下（${minutes(wait)}内没人反对按此结果结束）`,
  ], { status: res, score: s }))
  return true
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
      if (room.status === "scoring") room.scoringAt = Date.now()
      store.set(room)
      arm(room)
      count++
    } catch (err) {
      logger.error(`[Games-Plugin] 恢复围棋失败：${err.message}`)
      await store.remove(data.scope)
    }
  }
  if (count) logger.mark(`[Games-Plugin] 已恢复 ${count} 局围棋`)
}

/* ================= 指令 ================= */

export class Go extends plugin {
  constructor() {
    super({
      name: "Games-围棋",
      dsc: "围棋：双人对战",
      event: "message",
      priority: 106,
      rule: [
        { reg: reg(`^(?:${CN("围棋")}|#Go)\\s*(帮助|help)?$`), fnc: "help" },
        { reg: CREATE_RE, fnc: "create" },
        { reg: reg(`^(?:${CN("(?:加入|应战)围棋")}|#Go\\s*join)$`), fnc: "join" },
        { reg: reg(`^(?:${CN("(?:结束|取消)围棋")}|#Go\\s*end)$`), fnc: "end" },
        { reg: reg(`^(?:${CN("(?:围棋)?棋盘")}|#Go\\s*board)$`), fnc: "board" },
        { reg: reg(`^(?:${CN("(?:停一手|虚着|pass)")}|#Go\\s*pass)$`), fnc: "pass" },
        { reg: reg(`^(?:${CN("让子")}|#Go\\s*handicap)$`), fnc: "yieldTurn" },
        { reg: /^#?(同意|确认)数子$/, fnc: "agreeScore" },
        { reg: /^#?(继续对局|继续下棋|不同意数子)$/, fnc: "continueGame" },
        { reg: reg(`^(?:${CN("悔棋")}|#Go\\s*undo)$`), fnc: "undo" },
        { reg: /^#?(同意|拒绝)悔棋$/, fnc: "answerUndo" },
        { reg: reg(`^(?:${CN("(?:求和|提和)")}|#Go\\s*draw)$`), fnc: "draw" },
        { reg: /^#?(同意|拒绝)(求和|和棋)$/, fnc: "answerDraw" },
        { reg: reg(`^(?:${CN("(?:认输|投降)")}|#Go\\s*resign)$`), fnc: "resign" },
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
    const limit = Number(c.moveTimeout) || 0
    const maxYield = Number(c.maxYield) || 0
    const data = {
      title: GAME_NAME,
      subtitle: "中国规则 · 数子法 · 双人对战",
      piece: "弈",
      color: "black",
      badge: GAME_ID,
      sections: [
        {
          title: "规则速览",
          tag: "第一次下围棋先看这里",
          piece: "规",
          items: [
            { cmd: "气", desc: "棋子上下左右相邻的空点；相连的同色棋子共用气" },
            { cmd: "提子", desc: "一块棋的气全被对方堵住，就被提掉" },
            { cmd: "禁着点", desc: "下了之后自己没气、又提不掉对方的子，不能下" },
            { cmd: "打劫", desc: "被提一个劫子后不能马上提回，要先在别处下一手" },
            { cmd: "终局", desc: "双方连续停一手，数各自的活子 + 围住的空点" },
            { cmd: "胜负", desc: `黑先下有优势，黑方贴 ${formatZi(Number(c.komi) || 7.5)}，子多者胜` },
          ],
        },
        {
          title: "对局",
          tag: "群聊",
          piece: "黑",
          color: "black",
          items: [
            { cmd: "#发起围棋", desc: isQQBot(e) ? "选择棋盘大小后发起（9 / 13 / 19 路）" : `默认 ${c.defaultSize || 9} 路，开局时随机分配黑白` },
            { cmd: "#发起围棋 19 白", desc: "指定棋盘大小和自己的颜色" },
            { cmd: "#加入围棋", desc: "加入对局，加入后立即开始，黑先" },
            { cmd: "D4 / 下D4", desc: "轮到你时直接发坐标（列字母没有 I）" },
          ],
        },
        {
          title: "对局中",
          piece: "局",
          items: [
            { cmd: "#停一手", desc: "虚着；双方连续停一手进入数子" },
            ...(maxYield ? [{ cmd: "#让子", desc: `白方第一手之前可连续让子，最多 ${maxYield} 次（贴还让子数的一半）` }] : []),
            { cmd: "#同意数子 / #继续对局", desc: "数子时：双方同意结束，有异议继续下" },
            { cmd: "#棋盘", desc: "重新发送棋盘" },
            { cmd: "#悔棋 / #求和 / #认输", desc: "都需要对方同意" },
            { cmd: "#结束围棋", desc: "发起人 / 群管理 / 主人强制结束" },
          ],
          notes: [
            `${limit ? `每步限时 ${minutes(limit)}，超时判负；` : ""}数子时半透明的子为估算的死子，有异议可以继续下`,
          ],
        },
      ],
      footer: "English: #Go create | join | pass | handicap | board | undo | draw | resign | end",
    }
    const msg = [await helpMessage(data, "help-go")]
    const buttons = menuButtons(e)
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  /* ---------- 发起 / 加入 ---------- */

  async create(e) {
    if (!e.isGroup) {
      await e.reply("围棋需要两个人，请在群里发起")
      return true
    }
    const { scope, room, foreign } = context(e)
    if (foreign) return false
    if (room) {
      await e.reply(room.status === "waiting"
        ? [`本群已有 ${room.creator.name} 发起的围棋，发送 #加入围棋 应战`, makeButtons(e, [[{ text: "加入对局", cmd: "#加入围棋" }]])].filter(Boolean)
        : "本群正在下围棋，请等这局结束")
      return true
    }
    if (store.findByUser(e.user_id)) {
      await e.reply("你还有一局围棋没下完（可以 #认输 或请管理 #结束围棋）")
      return true
    }
    const arg = (e.msg.match(CREATE_RE)?.[1] || "").trim()
    const prefer = /黑|black/i.test(arg) ? BLACK : /白|white/i.test(arg) ? WHITE : 0
    let size = Number(arg.match(/\d+/)?.[0]) || 0
    if (size && !SIZES.includes(size)) {
      await e.reply("棋盘大小只能是 9、13 或 19 路")
      return true
    }
    if (!size) {
      const color = prefer ? ` ${prefer === BLACK ? "黑" : "白"}` : ""
      const buttons = sizeButtons(e, String(e.user_id), color)
      if (buttons) {
        await e.reply([...at({ isGroup: true }, e.user_id), "请选择棋盘大小", buttons])
        return true
      }
      size = SIZES.includes(Number(cfg().defaultSize)) ? Number(cfg().defaultSize) : 9
    }
    const creator = { id: String(e.user_id), name: playerName(e) }
    const newRoom = store.set(new Room({
      scope,
      selfId: e.self_id,
      isGroup: true,
      groupId: e.group_id,
      status: "waiting",
      creator,
      prefer,
      size,
      createdAt: Date.now(),
    }))
    newRoom.lastEvent = e
    await store.save(newRoom)
    arm(newRoom)
    const wait = Math.round((Number(cfg().joinTimeout) || 300) / 60)
    const msg = [
      `⚫ ${creator.name} 发起了一局 ${size} 路围棋${prefer ? `（执${sideName(prefer)}）` : "（黑白随机）"}\n`,
      `发送 #加入围棋 应战，${wait} 分钟内有效`,
    ]
    const buttons = makeButtons(e, [[
      { text: "加入对局", cmd: "#加入围棋", style: 1 },
      { text: "取消对局", cmd: "#取消围棋", permission: creator.id },
    ]])
    if (buttons) msg.push(buttons)
    await e.reply(msg)
    return true
  }

  async join(e) {
    if (!e.isGroup) {
      await e.reply("围棋需要两个人，请在群里进行")
      return true
    }
    const { room, foreign } = context(e)
    if (foreign) return false
    if (!room) {
      const buttons = makeButtons(e, [[{ text: "发起对局", cmd: "#发起围棋" }]])
      await e.reply(["本群还没有人发起围棋，发送 #发起围棋 创建", buttons].filter(Boolean))
      return true
    }
    if (room.status !== "waiting") {
      await e.reply("本群正在下围棋，请等这局结束")
      return true
    }
    const uid = String(e.user_id)
    if (room.creator.id === uid) {
      await e.reply("不能和自己对战哦，等其他群友加入吧")
      return true
    }
    if (store.findByUser(uid)) {
      await e.reply("你还有一局围棋没下完")
      return true
    }
    const joiner = { id: uid, name: playerName(e) }
    const creatorSide = room.prefer || (Math.random() < 0.5 ? BLACK : WHITE)
    room.players = creatorSide === BLACK ? { black: room.creator, white: joiner } : { black: joiner, white: room.creator }
    room.status = "playing"
    room.game = new GoGame({ size: room.size, komi: Number(cfg().komi) || 7.5, maxYield: Number(cfg().maxYield ?? 5) })
    room.turnStartAt = Date.now()
    room.lastEvent = e
    await store.save(room)
    arm(room)
    const { black, white } = room.players
    await e.reply(await boardMessage(e, room, [
      `${room.size} 路围棋开始！${room.prefer ? "" : "（随机分配黑白）"}${komiText(room.game)}\n`,
      "黑方：", ...at(room, black.id), `${black.name}\n`,
      "白方：", ...at(room, white.id), `${white.name}\n`,
      ...turnLine(room),
    ]))
    return true
  }

  /* ---------- 落子 / 停一手 / 让子 ---------- */

  /** 公共检查：返回 { room, side } 或 null（不处理）或 true（已回复） */
  async turnCheck(e, { allowOther = false } = {}) {
    const { room, foreign } = context(e)
    if (!room || foreign || (room.status !== "playing" && room.status !== "scoring")) return null
    const side = room.playerSide(e.user_id)
    if (!side) return null
    if (room.busy) {
      await e.reply("正在数子，请稍等…")
      return true
    }
    if (room.status === "scoring") {
      await e.reply("正在数子：发送 #同意数子 按结果结束，或 #继续对局 接着下")
      return true
    }
    if (!allowOther && side !== room.game.side) {
      await e.reply("还没轮到你，等对方下完再落子")
      return true
    }
    return { room, side }
  }

  /** 走完一手后的统一处理 */
  async afterMove(e, room, line) {
    room.lastEvent = e
    room.undoRequest = null
    room.drawOffer = null
    room.resignRequest = null
    if (room.game.bothPassed) return startScoring(room, e, [line, "\n"])
    room.turnStartAt = Date.now()
    await store.save(room)
    arm(room)
    await e.reply(await boardMessage(e, room, [line, "\n", ...turnLine(room)]))
    return true
  }

  async move(e) {
    const m = MOVE_RE.exec(String(e.msg || ""))
    if (!m) return false
    const chk = await this.turnCheck(e)
    if (chk === null) return false
    if (chk === true) return true
    const { room, side } = chk
    const point = parsePoint(m[1], room.game.size)
    if (point < 0) {
      const last = "ABCDEFGHJKLMNOPQRST"[room.game.size - 1]
      await e.reply(`❌ 坐标超出棋盘：列 A–${last}（没有 I），行 1–${room.game.size}，例如 D4`)
      return true
    }
    const res = room.game.play(point)
    if (res.error) {
      await e.reply(`❌ ${res.error}`)
      return true
    }
    return this.afterMove(e, room, describe(room, side, point, res.captured.length))
  }

  async pass(e) {
    const chk = await this.turnCheck(e)
    if (chk === null) return false
    if (chk === true) return true
    const { room, side } = chk
    room.game.pass()
    return this.afterMove(e, room, describe(room, side, PASS))
  }

  async yieldTurn(e) {
    const chk = await this.turnCheck(e)
    if (chk === null) return false
    if (chk === true) return true
    const { room, side } = chk
    const res = room.game.yieldTurn()
    if (res.error) {
      await e.reply(`❌ ${res.error}`)
      return true
    }
    return this.afterMove(e, room, `${describe(room, side, YIELD)}，黑方继续落子（${komiText(room.game)}）`)
  }

  /* ---------- 数子 ---------- */

  async agreeScore(e) {
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "scoring") return false
    const side = room.playerSide(e.user_id)
    if (!side) return false
    room.agree = { ...room.agree, [side]: true }
    room.lastEvent = e
    if (room.agree[BLACK] && room.agree[WHITE]) {
      room.game.end(room.scoreResult.winner, "score")
      return finish(room, e, ["双方同意数子结果\n"])
    }
    await store.save(room)
    const otherP = room.player(other(side))
    await e.reply([...at(room, otherP.id), `${room.player(side).name} 同意了数子结果，等你确认：#同意数子 或 #继续对局`])
    return true
  }

  async continueGame(e) {
    const { room, foreign } = context(e)
    if (!room || foreign || room.status !== "scoring") return false
    const side = room.playerSide(e.user_id)
    if (!side) return false
    room.status = "playing"
    room.scoreResult = null
    room.agree = {}
    room.lastEvent = e
    room.turnStartAt = Date.now()
    await store.save(room)
    arm(room)
    await e.reply(await boardMessage(e, room, [
      `${room.player(side).name} 对数子结果有异议，继续对局。把有争议的死子实际提掉后再停一手\n`,
      ...turnLine(room),
    ]))
    return true
  }

  /* ---------- 棋盘 ---------- */

  async board(e) {
    const { room, foreign } = context(e)
    if (!room || foreign) return false
    if (room.status === "waiting") {
      await e.reply(`${room.creator.name} 发起的围棋正在等待对手，发送 #加入围棋 应战`)
      return true
    }
    room.lastEvent = e
    if (room.status === "scoring") {
      await e.reply(await boardMessage(e, room, ["正在数子：#同意数子 或 #继续对局"], { status: scoreText(room.scoreResult).res, score: room.scoreResult }))
      return true
    }
    await e.reply(await boardMessage(e, room, turnLine(room)))
    return true
  }

  /* ---------- 悔棋 ---------- */

  async undo(e) {
    const chk = await this.turnCheck(e, { allowOther: true })
    if (chk === null) return false
    if (chk === true) return true
    const { room, side } = chk
    const game = room.game
    const n = game.side === side ? 2 : 1
    if (game.moveCount < n) {
      await e.reply("还没有可以悔的棋")
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
    if (!room || foreign || room.status !== "playing") return false
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
    const chk = await this.turnCheck(e, { allowOther: true })
    if (chk === null) return false
    if (chk === true) return true
    const { room, side } = chk
    room.lastEvent = e
    const timeout = (Number(cfg().requestTimeout) || 60) * 1000
    const offer = room.drawOffer
    if (offer && Date.now() - offer.at < timeout && offer.from !== String(e.user_id)) {
      room.game.end(0, "agreed")
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
    if (!room || foreign || room.status !== "playing") return false
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
    if (!room || foreign || (room.status !== "playing" && room.status !== "scoring")) return false
    const side = room.playerSide(e.user_id)
    if (!side) return false
    room.lastEvent = e
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
    if (!room || foreign || (room.status !== "playing" && room.status !== "scoring")) return false
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
      await e.reply("这里没有进行中的围棋")
      return true
    }
    const uid = String(e.user_id)
    const allowed = isAdmin(e) || (room.status === "waiting" && room.creator.id === uid)
    if (!allowed) {
      await e.reply(room.status === "waiting" ? "只有发起人、群管理或主人可以取消对局" : "对局中请使用 #认输；强制结束需要群管理或主人")
      return true
    }
    await store.remove(room.scope)
    room.status = "ended"
    await e.reply(room.game ? "围棋已强制结束，不计胜负" : "已取消围棋对局")
    return true
  }
}
