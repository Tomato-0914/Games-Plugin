import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** 插件根目录（按实际目录名，不写死） */
export const Plugin_Path = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
export const Plugin_Name = path.basename(Plugin_Path)
/** Yunzai 根目录 */
export const Yunzai_Path = process.cwd()

/** TRSS 加载插件前已设置 global.plugin / global.segment，这里兼容其他环境 */
async function importYunzai(file) {
  return import(pathToFileURL(path.join(Yunzai_Path, file)).href)
}

export const plugin = global.plugin ?? (await importYunzai("lib/plugins/plugin.js")).default
export const segment = global.segment ?? (await import("oicq").then(m => m.segment).catch(() => ({})))

export { default as Config } from "./Config.js"
export { default as Version } from "./Version.js"
export * from "./Adapter.js"
export { importYunzai }
