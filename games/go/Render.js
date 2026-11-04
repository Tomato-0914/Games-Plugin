/**
 * 围棋棋盘渲染：白色棋盘，四周印列字母（跳过 I）和行号；支持数子视图
 */
import { BLACK, WHITE, colName, starPoints } from "./Board.js"

const FONT = `"ChessKai","KaiTi","STKaiti","Noto Serif CJK SC","WenQuanYi Zen Hei","Microsoft YaHei",serif`
const CELL = { 9: 56, 13: 44, 19: 32 }
/** 棋盘尺寸：边距随棋子大小变化，保证边线上的子不会挡住坐标 */
function geometry(size) {
  const cell = CELL[size]
  const r = cell * 0.46
  const pad = Math.round(r + 30)
  return { cell, r, pad, W: cell * (size - 1) + pad * 2, label: pad - r - 13 }
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch])

function boardSvg(game, { score = null } = {}) {
  const size = game.size
  const { cell, r, pad, W, label } = geometry(size)
  const X = x => pad + x * cell
  const Y = y => pad + y * cell
  const out = []
  out.push(`<rect x="0" y="0" width="${W}" height="${W}" rx="8" fill="#fbfbf8"/>`)
  for (let k = 0; k < size; k++) {
    const w = k === 0 || k === size - 1 ? 2 : 1.1
    out.push(`<line x1="${X(0)}" y1="${Y(k)}" x2="${X(size - 1)}" y2="${Y(k)}" stroke="#2b2b2b" stroke-width="${w}"/>`)
    out.push(`<line x1="${X(k)}" y1="${Y(0)}" x2="${X(k)}" y2="${Y(size - 1)}" stroke="#2b2b2b" stroke-width="${w}"/>`)
  }
  for (const i of starPoints(size)) out.push(`<circle cx="${X(i % size)}" cy="${Y(Math.floor(i / size))}" r="${size === 19 ? 3.2 : 4}" fill="#2b2b2b"/>`)
  const fs = size === 19 ? 14 : 16
  for (let k = 0; k < size; k++) {
    out.push(`<text x="${X(k)}" y="${label}" class="lbl" font-size="${fs}">${colName(k)}</text>`)
    out.push(`<text x="${X(k)}" y="${W - label}" class="lbl" font-size="${fs}">${colName(k)}</text>`)
    out.push(`<text x="${label}" y="${Y(k)}" class="lbl" font-size="${fs}">${size - k}</text>`)
    out.push(`<text x="${W - label}" y="${Y(k)}" class="lbl" font-size="${fs}">${size - k}</text>`)
  }
  const dead = new Set(score?.dead || [])
  // 刚被提掉的子：淡色叉
  if (!score) {
    for (const i of game.lastCaptured || []) {
      const x = X(i % size)
      const y = Y(Math.floor(i / size))
      const d = cell * 0.18
      out.push(`<g stroke="#c9c9c9" stroke-width="2"><line x1="${x - d}" y1="${y - d}" x2="${x + d}" y2="${y + d}"/><line x1="${x + d}" y1="${y - d}" x2="${x - d}" y2="${y + d}"/></g>`)
    }
  }
  for (let i = 0; i < game.cells.length; i++) {
    const c = game.cells[i]
    if (!c) continue
    const x = X(i % size)
    const y = Y(Math.floor(i / size))
    const op = dead.has(i) ? ' opacity=".38"' : ""
    out.push(`<g${op}><circle cx="${x + 1.2}" cy="${y + 2}" r="${r}" fill="rgba(0,0,0,.26)"/>`
      + `<circle cx="${x}" cy="${y}" r="${r}" fill="${c === BLACK ? "url(#black)" : "url(#white)"}" stroke="${c === BLACK ? "#000" : "#8f8f8f"}" stroke-width="1.1"/></g>`)
  }
  // 数子：每个点画小方块表示归属
  if (score) {
    const q = cell * 0.26
    score.owner.forEach((o, i) => {
      if (!o) return
      const c = game.cells[i]
      if (c && !dead.has(i)) return
      const x = X(i % size)
      const y = Y(Math.floor(i / size))
      out.push(`<rect x="${x - q / 2}" y="${y - q / 2}" width="${q}" height="${q}" fill="${o === BLACK ? "#111" : "#fff"}" stroke="${o === BLACK ? "#000" : "#777"}" stroke-width="1"/>`)
    })
  } else {
    const last = game.lastMove
    if (last !== null && last >= 0) out.push(`<circle cx="${X(last % size)}" cy="${Y(Math.floor(last / size))}" r="${cell * 0.12}" fill="#e03a2f"/>`)
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
 * @param {import("./Board.js").GoGame} game
 * @param {object} info { black, white, title, status, last, score, fontUrl }
 *   last：上一手的文字说明；score：数子结果（显示死子与地域）
 */
export function renderHtml(game, { black = "黑方", white = "白方", title = "围棋", status = "", last = "", score = null, fontUrl = "" } = {}) {
  const turn = game.result || score ? 0 : game.side
  const { W } = geometry(game.size)
  const player = (color, name) => `<div class="player ${color === BLACK ? "b" : "w"} ${turn === color ? "active" : ""}">
      <span class="dot"></span><span class="role">${color === BLACK ? "黑方" : "白方"}</span><span class="name">${esc(name)}</span>
      <span class="cap">提 ${game.captures[color]}</span></div>`
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
.player { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 18px; padding: 6px 12px; border-radius: 22px; border: 2px solid rgba(255,255,255,.12); min-width: 0; }
.player .dot { width: 16px; height: 16px; border-radius: 50%; flex: none; }
.player.b .dot { background: radial-gradient(circle at 35% 30%, #777, #000); }
.player.w .dot { background: radial-gradient(circle at 35% 30%, #fff, #ccc); }
.player .role { opacity: .75; flex: none; }
.player .name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.player .cap { margin-left: auto; flex: none; font-size: 15px; opacity: .8; }
.player.active { border-color: #f5c14b; background: rgba(245,193,75,.14); }
.board { line-height: 0; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.55); }
.foot { display: flex; justify-content: space-between; align-items: center; font-size: 18px; min-height: 34px; margin-top: 8px; gap: 12px; }
.status { color: #ffcf5a; font-weight: bold; text-align: right; }
svg text { font-family: ${FONT}; text-anchor: middle; dominant-baseline: central; }
.lbl { fill: #444; font-weight: bold; }
</style></head><body><div id="container">
  <div class="bar"><span class="title">${esc(title)}</span><span class="round">${game.size} 路 · 第 ${game.stoneMoves} 手</span></div>
  <div class="players">${player(BLACK, black)}${player(WHITE, white)}</div>
  <div class="board">${boardSvg(game, { score })}</div>
  <div class="foot"><span>${esc(last)}</span><span class="status">${esc(status)}</span></div>
</div></body></html>`
}

/** 文字棋盘 */
export function renderText(game, { score = null } = {}) {
  const size = game.size
  const dead = new Set(score?.dead || [])
  const lines = [`　 ${Array.from({ length: size }, (_, x) => String.fromCharCode(0xff21 + "ABCDEFGHJKLMNOPQRST".charCodeAt(x) - 65)).join("")}`]
  for (let y = 0; y < size; y++) {
    let row = String(size - y).padStart(2, " ")
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const c = game.cells[i]
      if (c && !dead.has(i)) row += c === BLACK ? "●" : "○"
      else if (score && score.owner[i]) row += score.owner[i] === BLACK ? "■" : "□"
      else row += "＋"
    }
    lines.push(row)
  }
  return lines.join("\n")
}

export { WHITE }
