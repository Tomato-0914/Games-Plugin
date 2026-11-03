/**
 * 通用房间管理：内存中保存对局，同时写入 Redis，重启后恢复
 * 各棋种共用，room 的内容由棋种自己决定，只要求有 scope 字段并提供 serialize()
 */
const PREFIX = "Chess-Plugin"
const EXPIRE = 24 * 3600

export class RoomStore {
  /** @param {string} game 棋种标识，如 Chinese_Chess */
  constructor(game) {
    this.game = game
    this.rooms = new Map()
    this.timers = new Map()
  }

  key(scope) {
    return `${PREFIX}:${this.game}:room:${scope}`
  }

  get(scope) {
    return this.rooms.get(scope)
  }

  set(room) {
    this.rooms.set(room.scope, room)
    return room
  }

  /** 用户正在参与的对局 */
  findByUser(userId) {
    userId = String(userId)
    for (const room of this.rooms.values()) {
      if (room.status === "ended") continue
      if (room.members().includes(userId)) return room
    }
    return null
  }

  async save(room) {
    if (!global.redis) return
    try {
      await redis.set(this.key(room.scope), JSON.stringify(room.serialize()), { EX: EXPIRE })
    } catch (err) {
      logger?.error?.(`[Chess-Plugin] 保存对局失败：${err.message}`)
    }
  }

  async remove(scope) {
    this.clearTimers(scope)
    this.rooms.delete(scope)
    if (!global.redis) return
    try {
      await redis.del(this.key(scope))
    } catch {}
  }

  /** 读取 Redis 中保存的全部对局数据 */
  async loadAll() {
    if (!global.redis) return []
    const list = []
    try {
      const keys = await redis.keys(`${PREFIX}:${this.game}:room:*`)
      for (const key of keys) {
        try {
          const data = JSON.parse(await redis.get(key))
          if (data) list.push(data)
        } catch {
          await redis.del(key)
        }
      }
    } catch (err) {
      logger?.error?.(`[Chess-Plugin] 读取对局失败：${err.message}`)
    }
    return list
  }

  /* ---------- 定时器 ---------- */

  setTimer(scope, name, ms, fn) {
    const timers = this.timers.get(scope) || {}
    clearTimeout(timers[name])
    timers[name] = setTimeout(fn, Math.max(0, ms))
    timers[name].unref?.()
    this.timers.set(scope, timers)
  }

  clearTimers(scope) {
    const timers = this.timers.get(scope)
    if (timers) for (const t of Object.values(timers)) clearTimeout(t)
    this.timers.delete(scope)
  }
}
