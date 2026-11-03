/**
 * 扫雷盘面渲染：HTML（交给 puppeteer 截图）与文字盘面（降级）
 */
import { rowName } from "./Notation.js"

const FONT = `"ChessKai","KaiTi","STKaiti","Noto Serif CJK SC","WenQuanYi Zen Hei","Microsoft YaHei",serif`
const NUM_COLOR = ["", "#1f5fd1", "#2e8b3a", "#d0312d", "#1c2f8a", "#8a3b12", "#138a8a", "#222", "#6b6b6b"]
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch])

const MINE_SVG = `<svg viewBox="0 0 20 20" width="20" height="20"><g stroke="#111" stroke-width="2" stroke-linecap="round"><line x1="10" y1="1.5" x2="10" y2="18.5"/><line x1="1.5" y1="10" x2="18.5" y2="10"/><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></g><circle cx="10" cy="10" r="6" fill="#111"/><circle cx="8" cy="8" r="1.8" fill="#fff"/></svg>`
const FLAG_SVG = `<svg viewBox="0 0 20 20" width="20" height="20"><rect x="9" y="3" width="2" height="12" fill="#2b2b2b"/><path d="M11 3 L18 6.5 L11 10 Z" fill="#d62b1f"/><rect x="5" y="15" width="10" height="2.5" rx="1" fill="#2b2b2b"/></svg>`
const CROSS_SVG = `<svg class="cross" viewBox="0 0 20 20" width="24" height="24"><g stroke="#d62b1f" stroke-width="2.6" stroke-linecap="round"><line x1="3" y1="3" x2="17" y2="17"/><line x1="17" y1="3" x2="3" y2="17"/></g></svg>`

export const formatTime = sec => {
  sec = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`
}

/**
 * @param {import("./Board.js").Minefield} f
 * @param {object} info { title, player, steps, elapsed, status, last: number[], auto, hints, fontUrl }
 */
export function renderHtml(f, { title = "扫雷", player = "", steps = 0, elapsed = 0, status = "", last = [], auto = false, hints = "", fontUrl = "" } = {}) {
  const lastSet = new Set(last)
  const ended = f.ended
  const cell = f.cols > 16 ? 32 : 36
  const cells = []
  cells.push(`<div class="lbl"></div>`)
  for (let c = 0; c < f.cols; c++) cells.push(`<div class="lbl">${c + 1}</div>`)
  for (let r = 0; r < f.rows; r++) {
    cells.push(`<div class="lbl">${rowName(r)}</div>`)
    for (let c = 0; c < f.cols; c++) {
      const i = r * f.cols + c
      const cls = []
      let inner = ""
      if (f.open[i]) {
        cls.push("open")
        if (f.mine[i]) {
          cls.push("boom")
          inner = MINE_SVG
        } else if (f.count[i]) {
          inner = `<b style="color:${NUM_COLOR[f.count[i]]}">${f.count[i]}</b>`
        }
      } else if (f.flag[i]) {
        cls.push("hide")
        inner = FLAG_SVG
        if (ended && f.status === "lost" && !f.mine[i]) inner += CROSS_SVG
      } else if (ended && f.mine[i]) {
        cls.push("open", "mine")
        inner = MINE_SVG
      } else {
        cls.push("hide")
      }
      if (i === f.exploded) cls.push("boom")
      if (lastSet.has(i)) cls.push("last")
      cells.push(`<div class="cell ${cls.join(" ")}">${inner}</div>`)
    }
  }
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${fontUrl ? `@font-face { font-family: "ChessKai"; src: url("${fontUrl}") format("woff2"); font-display: block; }` : ""}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #2c1e12; font-family: ${FONT}; }
#container { display: inline-block; padding: 16px 18px 14px; color: #f6e7c8; background: linear-gradient(160deg, #4a3320, #24180d); }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.title { font-size: 24px; font-weight: bold; letter-spacing: 2px; }
.counters { display: flex; gap: 10px; }
.counter { display: flex; align-items: center; gap: 6px; background: #1a110a; border: 1.5px solid #6b4a2a; border-radius: 8px; padding: 3px 10px; font-size: 22px; color: #ff6b4a; font-family: Consolas, Menlo, monospace; font-weight: bold; }
.counter svg { width: 18px; height: 18px; }
.sub { display: flex; gap: 16px; font-size: 16px; opacity: .85; margin: 6px 0 10px; }
.board { display: grid; grid-template-columns: 24px repeat(${f.cols}, ${cell}px); grid-auto-rows: ${cell}px; gap: 0;
  background: linear-gradient(160deg, #f1d39a, #d9ab62); padding: 6px 10px 10px 4px; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
.lbl { display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: bold; color: #5b3a1a; }
.cell { display: flex; align-items: center; justify-content: center; position: relative; }
.cell.hide { background: linear-gradient(145deg, #e9c98d, #c9a063); border: 3px solid; border-color: #fbe9c4 #8a6034 #8a6034 #fbe9c4; }
.cell.open { background: #f7ead0; border: 1px solid #c9ab7a; }
.cell b { font-size: ${cell - 12}px; line-height: 1; font-family: Consolas, Menlo, "ChessKai", monospace; }
.cell.mine { background: #e8d3ad; }
.cell.boom { background: #e5483a !important; }
.cell.last::after { content: ""; position: absolute; inset: 1px; border: 2.5px solid #1e6fd9; border-radius: 3px; }
.cell svg.cross { position: absolute; }
.foot { margin-top: 10px; font-size: 18px; min-height: 26px; display: flex; justify-content: space-between; gap: 16px; }
.status { color: #ffcf5a; font-weight: bold; }
</style></head><body><div id="container">
  <div class="bar"><span class="title">${esc(title)}</span><span class="counters">
    <span class="counter">${MINE_SVG.replace('fill="#111"', 'fill="#ff6b4a"').replace(/stroke="#111"/, 'stroke="#ff6b4a"')}${String(f.minesLeft).padStart(3, "0")}</span>
    <span class="counter">${formatTime(elapsed)}</span>
  </span></div>
  <div class="sub"><span>玩家：${esc(player)}</span><span>第 ${steps} 步</span><span>自动翻开：${auto ? "开" : "关"}</span>${hints ? `<span>提示：${esc(hints)}</span>` : ""}</div>
  <div class="board">${cells.join("")}</div>
  <div class="foot"><span>翻开：C5　插旗：旗C5　多格：c1c2c3</span><span class="status">${esc(status)}</span></div>
</div></body></html>`
}

/** 文字盘面 */
export function renderText(f) {
  const FW = n => String.fromCharCode(0xff10 + n)
  const lines = []
  lines.push(`　 ${Array.from({ length: f.cols }, (_, c) => (c + 1 < 10 ? FW(c + 1) : String(c + 1).padStart(2))).join("")}`)
  for (let r = 0; r < f.rows; r++) {
    let row = `${rowName(r)} `
    for (let c = 0; c < f.cols; c++) {
      const i = r * f.cols + c
      if (f.open[i]) row += f.mine[i] ? "爆" : f.count[i] ? FW(f.count[i]) : "・"
      else if (f.flag[i]) row += f.ended && f.status === "lost" && !f.mine[i] ? "错" : "旗"
      else if (f.ended && f.mine[i]) row += "雷"
      else row += "■"
    }
    lines.push(row)
  }
  return lines.join("\n")
}
