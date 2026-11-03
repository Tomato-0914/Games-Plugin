/**
 * 测试用的最小 Yunzai 环境：plugin 基类、segment、logger、内存版 redis、Bot
 * 模拟 TRSS 加载器按优先级、正则匹配规则，返回 false 时继续匹配下一个
 */
class plugin {
  constructor({ name, dsc, event = "message", priority = 5000, rule = [] }) {
    Object.assign(this, { name, dsc, event, priority, rule })
  }
  reply(msg) {
    return this.e?.reply?.(msg)
  }
}

const segment = {
  at: qq => ({ type: "at", qq }),
  image: file => ({ type: "image", file }),
  button: (...data) => ({ type: "button", data }),
}

const noop = () => {}
const logger = { info: noop, warn: noop, error: (...a) => process.env.DEBUG && console.error(...a), mark: noop, debug: noop, green: s => s, red: s => s }

const kv = new Map()
const redis = {
  async set(k, v) { kv.set(k, v) },
  async get(k) { return kv.get(k) ?? null },
  async del(k) { kv.delete(k) },
  async keys(pattern) {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
    return [...kv.keys()].filter(k => re.test(k))
  },
}

const sent = []
const Bot = {
  pickGroup: id => ({ sendMsg: msg => sent.push({ group: id, msg }) }),
  pickFriend: id => ({ sendMsg: msg => sent.push({ user: id, msg }) }),
}

Object.assign(global, { plugin, segment, logger, redis, Bot })
export { kv, sent }

/** 加载插件类并按优先级排序 */
export async function loadApps(files) {
  const list = []
  for (const file of files) {
    const mod = await import(file)
    for (const cls of Object.values(mod)) {
      if (typeof cls !== "function" || !cls.prototype) continue
      const inst = new cls()
      if (inst.init) await inst.init()
      list.push({ cls, priority: inst.priority, rule: inst.rule })
    }
  }
  return list.sort((a, b) => a.priority - b.priority)
}

/** 构造消息事件并派发，返回回复列表 */
export function makeDispatcher(apps) {
  return async function dispatch({ msg, user = "10001", group = "500", nickname, isMaster = false, adapter = "OneBotv11", role = "member", self = "bot1" }) {
    const replies = []
    const e = {
      msg,
      user_id: user,
      group_id: group,
      isGroup: group !== null,
      isMaster,
      self_id: self,
      sender: { nickname: nickname ?? `用户${user}`, role },
      bot: { nickname: "柴郡", adapter: { id: adapter } },
      reply: async m => { replies.push(m); return { message_id: "1" } },
    }
    for (const app of apps) {
      for (const rule of app.rule) {
        if (!rule.reg.test(e.msg)) continue
        const p = Object.assign(new app.cls(e), { e })
        const res = await p[rule.fnc](e)
        if (res === false) continue
        return { handled: rule.fnc, replies, e }
      }
    }
    return { handled: null, replies, e }
  }
}

/** 把回复内容拼成文字，便于断言 */
export function textOf(replies) {
  return replies.flat(Infinity).map(m => {
    if (typeof m === "string") return m
    if (m?.type === "at") return `@${m.qq}`
    if (m?.type === "image") return "[图片]"
    if (m?.type === "button") return `[按钮:${m.data.flat().map(b => b.text).join(",")}]`
    return ""
  }).join("")
}
