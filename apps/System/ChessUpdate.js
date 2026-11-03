import fs from "node:fs/promises"
import path from "node:path"
import { exec } from "node:child_process"
import { plugin, Plugin_Name, Plugin_Path, Version } from "../../components/index.js"

/* ================= 插件更新 =================
 * #棋类更新       git pull，有新提交时展示更新日志；依赖变化时自动 pnpm install；PM2 守护下自动重启
 * #棋类强制更新   丢弃本地改动，与远程分支保持一致（git fetch + git reset --hard），其余同上
 * #棋类版本       当前版本与最近更新内容
 * 仅主人可用。重启后回到发起更新的群/私聊报告结果，进行中的对局会自动恢复。
 */

const RESTART_FILE = path.join(Plugin_Path, "data", "restart.json")

function run(cmd, options = {}) {
  return new Promise(resolve => {
    exec(cmd, { cwd: Plugin_Path, windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout ?? "").trim(), stderr: String(stderr ?? "").trim() })
    })
  })
}

const commitHash = async () => (await run("git rev-parse --short HEAD")).stdout
const commitTime = async () => (await run('git log -1 --pretty=%cd --date=format:"%Y-%m-%d %H:%M:%S"')).stdout || "未知"

let updating = false

/** 重启后发送成功通知（模块只加载一次，只检查一次） */
async function checkRestart() {
  let data
  try {
    data = JSON.parse(await fs.readFile(RESTART_FILE, "utf8"))
    await fs.unlink(RESTART_FILE)
  } catch {
    return
  }
  // 等待 Bot 连接上平台
  setTimeout(async () => {
    const msg = `✅ ${Plugin_Name} 重启成功，当前版本 v${Version.ver}（${await commitTime()}）`
    try {
      const bot = global.Bot?.[data.selfId] || global.Bot
      const target = data.isGroup ? bot?.pickGroup?.(data.id) : bot?.pickFriend?.(data.id)
      await target?.sendMsg?.(msg)
    } catch (err) {
      logger.error(`[${Plugin_Name}] 重启通知发送失败：${err.message}`)
    }
  }, 10000)
}
checkRestart()

export class ChessUpdate extends plugin {
  constructor() {
    super({
      name: "Chess-更新",
      dsc: "棋类插件更新与重启",
      event: "message",
      priority: -10,
      rule: [
        { reg: /^#?(棋类|Chess)(强制)?更新$/i, fnc: "update" },
        { reg: /^#?(棋类|Chess)版本$/i, fnc: "version" },
      ],
    })
  }

  async version(e) {
    const lines = [`${Plugin_Name} v${Version.ver}`, `最后提交：${await commitTime()}`]
    for (const item of Version.logs.slice(0, 3)) {
      lines.push("", `【${item.version}】`, ...item.logs.map(l => `· ${l}`))
    }
    await e.reply(lines.join("\n"))
    return true
  }

  async update(e) {
    if (!e.isMaster) {
      await e.reply("❌ 只有主人可以更新插件")
      return true
    }
    if (updating) {
      await e.reply("⏳ 正在更新中，请稍候…")
      return true
    }
    updating = true
    const force = /强制/.test(e.msg)
    const messages = []
    try {
      await e.reply(`⏳ 开始${force ? "强制" : ""}更新 ${Plugin_Name}…`)
      const oldCommit = await commitHash()

      let ret
      if (force) {
        ret = await run("git fetch --all --prune")
        if (!ret.error) ret = await run('git reset --hard "@{u}"')
      } else {
        ret = await run("git pull --no-rebase")
      }
      if (ret.error) {
        const detail = (ret.stderr || ret.error.message).slice(0, 500)
        const conflict = /overwritten|conflict|冲突|would be|divergent/i.test(detail)
        messages.push(`❌ 更新失败：\n${detail}${conflict && !force ? "\n\n本地文件有改动，可以发送 #棋类强制更新（会丢弃本地改动）" : ""}`)
        await this.sendAll(e, messages)
        return true
      }

      const newCommit = await commitHash()
      if (oldCommit === newCommit) {
        await e.reply(`☁️ 已是最新版本 v${Version.ver}\n最后提交：${await commitTime()}`)
        return true
      }

      const log = (await run(`git log ${oldCommit}..${newCommit} --pretty=format:"%h %s"`)).stdout
      messages.push(`✅ 更新完成：v${Version.ver}\n提交时间：${await commitTime()}`)
      if (log) messages.push(`📝 更新内容：\n${log}`)

      // 依赖变化时安装依赖
      const changed = (await run(`git diff --name-only ${oldCommit} ${newCommit}`)).stdout.split(/\r?\n/)
      if (changed.includes("package.json")) {
        await e.reply("📦 依赖有变化，正在执行 pnpm install…")
        const install = await run("pnpm install", { timeout: 180000 })
        messages.push(install.error ? `⚠️ 依赖安装失败，请手动执行 pnpm install：\n${(install.stderr || install.error.message).slice(0, 300)}` : "✅ 依赖安装完成")
      }

      if (process.env.pm_id === undefined) {
        messages.push("⚠️ 当前不是 PM2 守护运行，请手动重启 Bot 加载新代码")
        await this.sendAll(e, messages)
        return true
      }

      await fs.mkdir(path.dirname(RESTART_FILE), { recursive: true })
      await fs.writeFile(RESTART_FILE, JSON.stringify({
        isGroup: !!e.isGroup,
        id: e.isGroup ? e.group_id : e.user_id,
        selfId: e.self_id,
        time: Date.now(),
      }))
      messages.push("🔁 3 秒后重启以加载新代码，进行中的对局会自动恢复")
      await this.sendAll(e, messages)
      setTimeout(() => {
        logger.mark(`[${Plugin_Name}] 更新完成，重启进程`)
        process.exit(0)
      }, 3000)
    } catch (err) {
      logger.error(`[${Plugin_Name}] 更新出错：${err.stack || err}`)
      await e.reply(`❌ 更新出错：${err.message}`)
    } finally {
      updating = false
    }
    return true
  }

  /** 合并转发发送，失败时发普通文字（官方机器人下由适配器转成 Markdown） */
  async sendAll(e, messages) {
    const makeForward = e.group?.makeForwardMsg || e.friend?.makeForwardMsg || global.Bot?.makeForwardMsg
    if (messages.length > 1 && makeForward) {
      try {
        const nickname = e.bot?.nickname || Plugin_Name
        const user_id = e.bot?.uin || e.self_id || 10000
        const target = e.group?.makeForwardMsg ? e.group : e.friend?.makeForwardMsg ? e.friend : global.Bot
        await e.reply(await target.makeForwardMsg(messages.map(message => ({ user_id, nickname, message }))))
        return
      } catch (err) {
        logger.warn(`[${Plugin_Name}] 合并转发失败，改发文字：${err.message}`)
      }
    }
    await e.reply(messages.join("\n\n"))
  }
}
