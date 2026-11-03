import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)))

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return {}
  }
}

/** 读取 CHANGELOG.md 中的版本段落：# 1.0.0 开头，下面 * 开头的为条目 */
function readChangelog() {
  try {
    const list = []
    let cur = null
    for (const line of fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8").split(/\r?\n/)) {
      const ver = /^#\s*(\S+)/.exec(line)
      if (ver) {
        cur = { version: ver[1], logs: [] }
        list.push(cur)
      } else if (cur && /^\s*[*-]\s+/.test(line)) {
        cur.logs.push(line.replace(/^\s*[*-]\s+/, "").replace(/`/g, ""))
      }
    }
    return list
  } catch {
    return []
  }
}

const Version = {
  get ver() {
    return readJson(path.join(ROOT, "package.json")).version || "未知"
  },
  get yunzai() {
    return readJson(path.join(process.cwd(), "package.json")).version || ""
  },
  get logs() {
    return readChangelog()
  },
}

export default Version
