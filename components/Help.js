/**
 * 帮助图片：生成 HTML 交给 puppeteer 截图，失败时由调用方改发文字
 */
import { screenshot, fontUrl } from "./Render.js"

const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch])
const FONT = `"ChessKai","KaiTi","STKaiti","Kaiti SC","Noto Serif CJK SC","WenQuanYi Zen Hei","Microsoft YaHei",serif`

/** 棋子样式的小图标 */
const piece = (ch, color = "red") => `<span class="piece ${color}"><span>${esc(ch)}</span></span>`

function itemsHtml(items = []) {
  return items.map(i => `<div class="item"><span class="cmd">${esc(i.cmd)}</span><span class="desc">${esc(i.desc)}</span></div>`).join("")
}

function sectionHtml(s) {
  const head = `<div class="sec-head">${s.piece ? piece(s.piece, s.color) : ""}<div class="sec-title"><span>${esc(s.title)}</span>${s.tag ? `<em>${esc(s.tag)}</em>` : ""}</div></div>`
  const desc = s.desc ? `<div class="sec-desc">${esc(s.desc)}</div>` : ""
  const notes = (s.notes || []).map(n => `<li>${esc(n)}</li>`).join("")
  return `<div class="card ${s.wide ? "wide" : ""}">${head}${desc}<div class="items ${s.cols === 2 ? "two" : ""}">${itemsHtml(s.items)}</div>${notes ? `<ul class="notes">${notes}</ul>` : ""}</div>`
}

/**
 * @param {object} data { title, subtitle, badge, sections: [{ title, tag, piece, color, desc, items: [{ cmd, desc }], notes, cols }], footer }
 */
export function renderHelpHtml(data, font = fontUrl) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${font ? `@font-face { font-family: "ChessKai"; src: url("${font}") format("woff2"); font-display: block; }` : ""}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #2c1e12; font-family: ${FONT}; }
#container { width: 680px; padding: 26px 24px 20px; color: #3b2611;
  background: radial-gradient(circle at 20% 0%, #5a3d22 0, transparent 55%), linear-gradient(160deg, #4a3320, #24180d); }
.header { display: flex; align-items: center; gap: 16px; color: #f6e7c8; margin-bottom: 18px; }
.header .piece { width: 64px; height: 64px; font-size: 38px; }
.header h1 { font-size: 38px; letter-spacing: 4px; }
.header .sub { font-size: 17px; opacity: .8; margin-top: 4px; letter-spacing: 1px; }
.header .badge { margin-left: auto; align-self: flex-start; font-size: 15px; padding: 4px 12px; border-radius: 14px; border: 1.5px solid #f5c14b; color: #f5c14b; font-family: Consolas, Menlo, monospace; }
.card { background: linear-gradient(160deg, #f6e2b8, #e9c98d); border-radius: 12px; padding: 14px 18px 12px; margin-bottom: 14px;
  box-shadow: 0 3px 10px rgba(0,0,0,.35), inset 0 0 0 2px rgba(122,75,30,.25); }
.sec-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.sec-head .piece { width: 38px; height: 38px; font-size: 22px; }
.sec-title { display: flex; align-items: baseline; gap: 10px; font-size: 23px; font-weight: bold; color: #5b3a1a; }
.sec-title em { font-style: normal; font-size: 14px; color: #8a6034; font-family: Consolas, Menlo, monospace; }
.sec-desc { font-size: 16px; color: #7a5530; margin: -2px 0 8px; }
.items.two { display: grid; grid-template-columns: 1fr 1fr; column-gap: 14px; }
.item { display: flex; align-items: baseline; gap: 10px; padding: 6px 0; border-top: 1px dashed rgba(122,75,30,.3); font-size: 18px; }
.item:first-child, .items.two .item:nth-child(2) { border-top: none; }
.cmd { flex: none; color: #b3261e; font-weight: bold; background: rgba(255,250,235,.7); border: 1px solid rgba(179,38,30,.35); border-radius: 6px; padding: 1px 8px; }
.desc { color: #4a2e14; }
.notes { margin: 8px 0 2px 20px; font-size: 16px; color: #6b4423; line-height: 1.6; }
.piece { display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 50%; font-weight: bold;
  background: radial-gradient(circle at 40% 35%, #fff6df, #f2d49c 70%, #d8a960); border: 2px solid #7a4b1e; box-shadow: 1px 2px 4px rgba(0,0,0,.4); }
.piece span { display: flex; align-items: center; justify-content: center; width: 82%; height: 82%; border-radius: 50%; }
.piece.red { color: #c0271d; } .piece.red span { border: 1.5px solid #c0271d; }
.piece.black { color: #1f1f1f; } .piece.black span { border: 1.5px solid #1f1f1f; }
.footer { text-align: center; color: #cdb48a; font-size: 14px; margin-top: 4px; letter-spacing: 1px; }
</style></head><body><div id="container">
  <div class="header">${piece(data.piece || "棋", data.color || "red")}<div><h1>${esc(data.title)}</h1>${data.subtitle ? `<div class="sub">${esc(data.subtitle)}</div>` : ""}</div>${data.badge ? `<span class="badge">${esc(data.badge)}</span>` : ""}</div>
  ${(data.sections || []).map(sectionHtml).join("\n")}
  ${data.footer ? `<div class="footer">${esc(data.footer)}</div>` : ""}
</div></body></html>`
}

/** 帮助的文字版（截图失败时） */
export function renderHelpText(data) {
  const lines = [`【${data.title}】${data.badge ? ` ${data.badge}` : ""}`]
  if (data.subtitle) lines.push(data.subtitle)
  for (const s of data.sections || []) {
    lines.push("", `${s.title}${s.tag ? ` ${s.tag}` : ""}`)
    if (s.desc) lines.push(`  ${s.desc}`)
    for (const i of s.items || []) lines.push(`  ${i.cmd}　${i.desc}`)
    for (const n of s.notes || []) lines.push(`  · ${n}`)
  }
  if (data.footer) lines.push("", data.footer)
  return lines.join("\n")
}

/** 帮助消息：图片，失败时文字 */
export async function helpMessage(data, saveId) {
  return (await screenshot(renderHelpHtml(data), saveId)) || renderHelpText(data)
}
