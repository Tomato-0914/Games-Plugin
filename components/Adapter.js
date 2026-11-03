/**
 * 适配器相关：判断是否为 QQ 官方机器人、按钮、昵称、权限
 */
import Config from "./Config.js"

/** 是否为 QQBot-Plugin（QQ 官方机器人）的事件 */
export function isQQBot(e) {
  return e?.bot?.adapter?.id === "QQBot" || e?.adapter_id === "QQBot" || e?.adapter_name === "QQBot"
}

/**
 * 生成按钮消息段，仅官方机器人生效，其他适配器返回 null
 * @param e 事件
 * @param rows 按钮行：[[{ text, cmd, permission }]]
 */
export function makeButtons(e, rows) {
  if (!isQQBot(e) || Config.qqbot?.buttons === false) return null
  const seg = global.segment
  if (typeof seg?.button !== "function") return null
  return seg.button(...rows.filter(row => row.length).map(row => row.map(b => {
    const button = {
      text: b.text,
      callback: b.cmd,
      // 回调按钮同时写入 action.data，适配器缓存过期（5 分钟）或重启后点击仍然有效
      QQBot: { action: { data: b.cmd } },
    }
    if (b.clicked) button.clicked_text = b.clicked
    if (b.permission) button.permission = b.permission
    if (b.style !== undefined) button.QQBot.render_data = { style: b.style }
    return button
  })))
}

/** 玩家显示名 */
export function playerName(e) {
  const name = e?.sender?.card || e?.sender?.nickname || e?.member?.card || e?.member?.nickname
  if (name) return String(name).slice(0, 16)
  return `玩家${String(e?.user_id ?? "").slice(-4)}`
}

/** 群管理、群主或主人 */
export function isAdmin(e) {
  return !!(e?.isMaster || e?.member?.is_admin || e?.member?.is_owner || ["admin", "owner"].includes(e?.sender?.role))
}
