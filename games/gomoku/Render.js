/**
 * 五子棋棋盘渲染：白色棋盘，四周印列字母（A–O）和行号（1–15）
 */
import { SIZE, BLACK, WHITE, xyOf, pointName } from "./Board.js"

const FONT = `"ChessKai","KaiTi","STKaiti","Noto Serif CJK SC","WenQuanYi Zen Hei","Microsoft YaHei",serif`
const COLS = "ABCDEFGHIJKLMNO"
const CELL = 40
const PAD = 44
const W = CELL * (SIZE - 1) + PAD * 2
const STARS = ["D4", "D12", "H8", "L4", "L12"]
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch])

const X = x => PAD + x * CELL
const Y = y => PAD + y * CELL

function boardSvg(game, { forbidden = [] } = {}) {
  const out = []
  out.push(`<rect x="0" y="0" width="${W}" height="${W}" rx="8" fill="#fbfbf8"/>`)
  for (let k = 0; k < SIZE; k++) {
    const w = k === 0 || k === SIZE - 1 ? 2.2 : 1.2
    out.push(`<line x1="${X(0)}" y1="${Y(k)}" x2="${X(SIZE - 1)}" y2="${Y(k)}" stroke="#2b2b2b" stroke-width="${w}"/>`)
    out.push(`<line x1="${X(k)}" y1="${Y(0)}" x2="${X(k)}" y2="${Y(SIZE - 1)}" stroke="#2b2b2b" stroke-width="${w}"/>`)
  }
  for (const p of STARS) {
    const x = COLS.indexOf(p[0])
    const y = SIZE - Number(p.slice(1))
    out.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="4" fill="#2b2b2b"/>`)
  }
  // 四周坐标
  for (let k = 0; k < SIZE; k++) {
    out.push(`<text x="${X(k)}" y="${PAD - 24}" class="lbl">${COLS[k]}</text>`)
    out.push(`<text x="${X(k)}" y="${W - PAD + 26}" class="lbl">${COLS[k]}</text>`)
    out.push(`<text x="${PAD - 26}" y="${Y(k)}" class="lbl">${SIZE - k}</text>`)
    out.push(`<text x="${W - PAD + 26}" y="${Y(k)}" class="lbl">${SIZE - k}</text>`)
  }
  // 禁手点
  for (const i of forbidden) {
    const [x, y] = xyOf(i)
    const d = 7
    out.push(`<g stroke="#e03a2f" stroke-width="2.6" stroke-linecap="round"><line x1="${X(x) - d}" y1="${Y(y) - d}" x2="${X(x) + d}" y2="${Y(y) + d}"/><line x1="${X(x) + d}" y1="${Y(y) - d}" x2="${X(x) - d}" y2="${Y(y) + d}"/></g>`)
  }
  // 棋子
  const win = new Set(game.winningLine())
  game.moves.forEach(i => {
    const [x, y] = xyOf(i)
    const color = game.cells[i]
    const fill = color === BLACK ? "url(#black)" : "url(#white)"
    const stroke = color === BLACK ? "#000" : "#8f8f8f"
    out.push(`<circle cx="${X(x) + 1.5}" cy="${Y(y) + 2.5}" r="17" fill="rgba(0,0,0,.28)"/>`)
    out.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="17" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`)
    if (win.has(i)) out.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="20" fill="none" stroke="#e03a2f" stroke-width="3"/>`)
  })
  const last = game.lastMove
  if (last >= 0) {
    const [x, y] = xyOf(last)
    out.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="5" fill="#e03a2f"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<defs>
  <radialGradient id="black" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#6a6a6a"/><stop offset=".45" stop-color="#262626"/><stop offset="1" stop-color="#050505"/></radialGradient>
  <radialGradient id="white" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#eeeeee"/><stop offset="1" stop-color="#cfcfcf"/></radialGradient>
</defs>
${out.join("\n")}
</svg>`
}

/**
 * @param {import("./Board.js").GomokuGame} game
 * @param {object} info { black, white, title, status, forbidden: number[], fontUrl }
 */
export function renderHtml(game, { black = "黑方", white = "白方", title = "五子棋", status = "", forbidden = [], fontUrl = "" } = {}) {
  const turn = game.result ? 0 : game.side
  const last = game.lastMove
  const lastText = last >= 0 ? `${game.cells[last] === BLACK ? "黑" : "白"}：${pointName(last)}` : "尚未落子"
  const player = (color, name) => `<div class="player ${color === BLACK ? "b" : "w"} ${turn === color ? "active" : ""}">
      <span class="dot"></span><span class="role">${color === BLACK ? "黑方" : "白方"}</span><span class="name">${esc(name)}</span></div>`
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${fontUrl ? `@font-face { font-family: "ChessKai"; src: url("${fontUrl}") format("woff2"); font-display: block; }` : ""}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #2c2c2c; font-family: ${FONT}; }
#container { width: ${W + 32}px; padding: 16px; color: #f2f2f2; background: linear-gradient(160deg, #3d3d3d, #1f1f1f); }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; }
.title { font-size: 24px; font-weight: bold; letter-spacing: 2px; }
.round { font-size: 17px; opacity: .85; }
.players { display: flex; gap: 12px; margin: 4px 0 10px; }
.player { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 19px; padding: 6px 14px; border-radius: 22px; border: 2px solid rgba(255,255,255,.12); min-width: 0; }
.player .dot { width: 16px; height: 16px; border-radius: 50%; flex: none; }
.player.b .dot { background: radial-gradient(circle at 35% 30%, #777, #000); }
.player.w .dot { background: radial-gradient(circle at 35% 30%, #fff, #ccc); }
.player .role { opacity: .75; flex: none; }
.player .name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.player.active { border-color: #f5c14b; background: rgba(245,193,75,.14); }
.player.active::after { content: "落子中"; margin-left: auto; font-size: 14px; color: #f5c14b; flex: none; }
.board { line-height: 0; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.55); }
.foot { display: flex; justify-content: space-between; align-items: center; font-size: 18px; min-height: 34px; margin-top: 8px; gap: 12px; }
.status { color: #ffcf5a; font-weight: bold; }
svg text { font-family: ${FONT}; text-anchor: middle; dominant-baseline: central; }
.lbl { font-size: 17px; fill: #444; font-weight: bold; }
</style></head><body><div id="container">
  <div class="bar"><span class="title">${esc(title)}</span><span class="round">第 ${game.moveCount} 手</span></div>
  <div class="players">${player(BLACK, black)}${player(WHITE, white)}</div>
  <div class="board">${boardSvg(game, { forbidden })}</div>
  <div class="foot"><span>上一手　${esc(lastText)}</span><span class="status">${esc(status)}</span></div>
</div></body></html>`
}

/** 文字棋盘 */
export function renderText(game, { forbidden = [] } = {}) {
  const ban = new Set(forbidden)
  const last = game.lastMove
  const lines = [`　 ${[...COLS].map(c => String.fromCharCode(0xff21 + COLS.indexOf(c))).join("")}`]
  for (let y = 0; y < SIZE; y++) {
    let row = String(SIZE - y).padStart(2, " ")
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x
      const c = game.cells[i]
      if (c === BLACK) row += i === last ? "◆" : "●"
      else if (c === WHITE) row += i === last ? "◇" : "○"
      else row += ban.has(i) ? "×" : "＋"
    }
    lines.push(row)
  }
  return lines.join("\n")
}

export { WHITE }
