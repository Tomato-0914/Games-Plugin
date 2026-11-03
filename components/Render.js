/**
 * 截图：使用 Yunzai 自带的 puppeteer，失败时返回 null（调用方改发文字棋盘）
 */
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Plugin_Path, importYunzai } from "./index.js"

/** 内置字体（霞鹜文楷），避免服务器缺少中文字体 */
const FONT_FILE = path.join(Plugin_Path, "resources/fonts/LXGWWenKai-Medium.woff2")
export const fontUrl = fs.existsSync(FONT_FILE) ? pathToFileURL(FONT_FILE).href : ""

let renderer
async function getRenderer() {
  if (renderer !== undefined) return renderer
  try {
    renderer = (await importYunzai("lib/puppeteer/puppeteer.js")).default || null
  } catch (err) {
    logger?.warn?.(`[Games-Plugin] 无法加载 puppeteer，将改发文字：${err.message}`)
    renderer = null
  }
  return renderer
}

/**
 * @param {string} html 完整页面
 * @param {string} saveId 临时文件名（同一时刻不同对局不能相同）
 * @returns 图片消息段或 null
 */
export async function screenshot(html, saveId) {
  const r = await getRenderer()
  if (!r?.screenshot) return null
  try {
    const img = await r.screenshot("games-plugin", {
      tplFile: path.join(Plugin_Path, "resources/common/page.html"),
      saveId: String(saveId).replace(/[^\w-]/g, "_"),
      html,
      imgType: "jpeg",
      quality: 92,
    })
    return img || null
  } catch (err) {
    logger?.error?.(`[Games-Plugin] 截图失败：${err.message}`)
    return null
  }
}
