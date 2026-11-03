import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const DEFAULT_FILE = path.join(ROOT, "config/default_config/config.yaml")
const USER_FILE = path.join(ROOT, "config/config.yaml")

function merge(def, user) {
  if (Array.isArray(def) || typeof def !== "object" || def === null) return user === undefined ? def : user
  const out = { ...def }
  for (const [k, v] of Object.entries(user || {})) out[k] = k in def ? merge(def[k], v) : v
  return out
}

/**
 * 配置：config/config.yaml（首次启动从 default_config 复制）
 * 修改后无需重启，按文件修改时间自动重新读取
 */
class Config {
  constructor() {
    this.cache = null
    this.mtime = 0
    try {
      if (!fs.existsSync(USER_FILE)) fs.copyFileSync(DEFAULT_FILE, USER_FILE)
    } catch (err) {
      logger?.error?.(`[Chess-Plugin] 创建配置文件失败：${err.message}`)
    }
  }

  get all() {
    let mtime = 0
    try {
      mtime = fs.statSync(USER_FILE).mtimeMs
    } catch {}
    if (this.cache && mtime === this.mtime) return this.cache
    const def = YAML.parse(fs.readFileSync(DEFAULT_FILE, "utf8")) || {}
    let user = {}
    try {
      if (mtime) user = YAML.parse(fs.readFileSync(USER_FILE, "utf8")) || {}
    } catch (err) {
      logger?.error?.(`[Chess-Plugin] config.yaml 格式错误，使用默认配置：${err.message}`)
    }
    this.cache = merge(def, user)
    this.mtime = mtime
    return this.cache
  }

  get xiangqi() {
    return this.all.xiangqi
  }

  get engine() {
    return this.all.engine
  }

  get qqbot() {
    return this.all.qqbot
  }

  get render() {
    return this.all.render
  }
}

export default new Config()
