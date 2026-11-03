import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Plugin_Title, Plugin_Path, Version } from "./components/index.js"

/** 遍历 apps/ 加载所有插件类（同柴郡插件） */
async function traverse(dir) {
  const list = []
  for (const file of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, file.name)
    if (file.isDirectory()) list.push(...await traverse(full))
    else if (file.name.endsWith(".js")) list.push(full)
  }
  return list
}

const start = Date.now()
const apps = {}
const errors = []
for (const file of await traverse(path.join(Plugin_Path, "apps"))) {
  try {
    const mod = await import(pathToFileURL(file).href)
    for (const [key, value] of Object.entries(mod)) {
      if (typeof value !== "function" || !value.prototype) continue
      let name = key
      for (let i = 1; Object.hasOwn(apps, name); i++) name = `${key}_${i}`
      apps[name] = value
    }
  } catch (err) {
    errors.push(path.basename(file))
    logger.error(`[${Plugin_Title}] 加载失败：${file}\n${err.stack}`)
  }
}

logger.mark(logger.green(`[${Plugin_Title}] 群聊小游戏插件 v${Version.ver} 加载完成，共 ${Object.keys(apps).length} 个功能，耗时 ${Date.now() - start}ms`))
if (errors.length) logger.error(`[${Plugin_Title}] ${errors.length} 个文件加载失败：${errors.join("、")}`)

export { apps }
