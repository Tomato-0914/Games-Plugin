/**
 * 棋盘渲染：生成 HTML（内嵌 SVG），交给 puppeteer 截图；另有文字棋盘作为降级方案
 */
import { RED, rowOf, colOf, moveFrom, moveTo } from "./Board.js"

const CN_NUM = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
const NAMES = {
  [RED]: ["", "帅", "仕", "相", "马", "车", "炮", "兵"],
  [-RED]: ["", "将", "士", "象", "马", "车", "炮", "卒"],
}
/** 文字棋盘里黑方用繁体，和红方区分开 */
const TEXT_NAMES = {
  [RED]: ["", "帅", "仕", "相", "马", "车", "炮", "兵"],
  [-RED]: ["", "将", "士", "象", "馬", "車", "砲", "卒"],
}

const CELL = 60
const PAD_X = 62
const PAD_TOP = 64
const PAD_BOTTOM = 84
const W = CELL * 8 + PAD_X * 2
const H = CELL * 9 + PAD_TOP + PAD_BOTTOM
const FONT = `"KaiTi","STKaiti","Kaiti SC","AR PL UKai CN","Noto Serif CJK SC","Source Han Serif SC","WenQuanYi Zen Hei","Microsoft YaHei",serif`

export const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch])

function boardSvg(game, flip) {
  const pos = game.pos
  const X = c => PAD_X + (flip ? 8 - c : c) * CELL
  const Y = r => PAD_TOP + (flip ? 9 - r : r) * CELL
  const out = []
  const line = (x1, y1, x2, y2, w = 1.6) => out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#5b3a1a" stroke-width="${w}"/>`)

  // 底板与外框
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#wood)"/>`)
  out.push(`<rect x="${PAD_X - 7}" y="${PAD_TOP - 7}" width="${CELL * 8 + 14}" height="${CELL * 9 + 14}" fill="none" stroke="#5b3a1a" stroke-width="3.5"/>`)
  for (let r = 0; r < 10; r++) line(PAD_X, PAD_TOP + r * CELL, PAD_X + 8 * CELL, PAD_TOP + r * CELL, r === 0 || r === 9 ? 2.4 : 1.6)
  for (let c = 0; c < 9; c++) {
    const x = PAD_X + c * CELL
    if (c === 0 || c === 8) line(x, PAD_TOP, x, PAD_TOP + 9 * CELL, 2.4)
    else {
      line(x, PAD_TOP, x, PAD_TOP + 4 * CELL)
      line(x, PAD_TOP + 5 * CELL, x, PAD_TOP + 9 * CELL)
    }
  }
  // 九宫
  for (const [r1, r2] of [[0, 2], [7, 9]]) {
    line(PAD_X + 3 * CELL, PAD_TOP + r1 * CELL, PAD_X + 5 * CELL, PAD_TOP + r2 * CELL)
    line(PAD_X + 5 * CELL, PAD_TOP + r1 * CELL, PAD_X + 3 * CELL, PAD_TOP + r2 * CELL)
  }
  // 炮位、兵位标记
  const mark = (r, c) => {
    const x = PAD_X + c * CELL
    const y = PAD_TOP + r * CELL
    const d = 5
    const l = 11
    for (const sx of [-1, 1]) {
      if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) continue
      for (const sy of [-1, 1]) {
        out.push(`<polyline points="${x + sx * (d + l)},${y + sy * d} ${x + sx * d},${y + sy * d} ${x + sx * d},${y + sy * (d + l)}" fill="none" stroke="#5b3a1a" stroke-width="1.4"/>`)
      }
    }
  }
  for (const r of [2, 7]) for (const c of [1, 7]) mark(r, c)
  for (const r of [3, 6]) for (const c of [0, 2, 4, 6, 8]) mark(r, c)
  // 楚河汉界
  const ry = PAD_TOP + 4.5 * CELL
  out.push(`<text x="${PAD_X + 2 * CELL}" y="${ry}" class="river">楚 河</text>`)
  out.push(`<text x="${PAD_X + 6 * CELL}" y="${ry}" class="river">漢 界</text>`)

  // 纵线编号与坐标
  for (let dc = 0; dc < 9; dc++) {
    const c = flip ? 8 - dc : dc
    const x = PAD_X + dc * CELL
    const topLabel = flip ? CN_NUM[9 - c] : String(c + 1)
    const bottomLabel = flip ? String(c + 1) : CN_NUM[9 - c]
    out.push(`<text x="${x}" y="${PAD_TOP - 46}" class="label">${topLabel}</text>`)
    out.push(`<text x="${x}" y="${PAD_TOP + 9 * CELL + 45}" class="label">${bottomLabel}</text>`)
    out.push(`<text x="${x}" y="${PAD_TOP + 9 * CELL + 68}" class="coord">${"abcdefghi"[c]}</text>`)
  }
  for (let dr = 0; dr < 10; dr++) {
    const r = flip ? 9 - dr : dr
    out.push(`<text x="${PAD_X - 50}" y="${PAD_TOP + dr * CELL}" class="coord">${9 - r}</text>`)
  }

  // 上一步
  const last = game.lastRecord
  if (last) {
    const f = moveFrom(last.move)
    const t = moveTo(last.move)
    out.push(`<circle cx="${X(colOf(f))}" cy="${Y(rowOf(f))}" r="9" fill="none" stroke="#1e6fd9" stroke-width="2.5" stroke-dasharray="4 3"/>`)
    const x = X(colOf(t))
    const y = Y(rowOf(t))
    const a = 29
    const l = 10
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      out.push(`<polyline points="${x + sx * a},${y + sy * (a - l)} ${x + sx * a},${y + sy * a} ${x + sx * (a - l)},${y + sy * a}" fill="none" stroke="#1e6fd9" stroke-width="3"/>`)
    }
  }

  // 被将军的一方
  const checked = !game.result && game.inCheck ? pos.kingSq[pos.side] : -1
  if (game.result?.reason === "checkmate") {
    const sq = pos.kingSq[pos.side]
    out.push(`<circle cx="${X(colOf(sq))}" cy="${Y(rowOf(sq))}" r="31" fill="rgba(231,76,60,.35)" stroke="#e74c3c" stroke-width="4"/>`)
  } else if (checked >= 0) {
    out.push(`<circle cx="${X(colOf(checked))}" cy="${Y(rowOf(checked))}" r="31" fill="rgba(231,76,60,.25)" stroke="#e74c3c" stroke-width="4"/>`)
  }

  // 棋子
  for (let sq = 0; sq < 90; sq++) {
    const p = pos.board[sq]
    if (!p) continue
    const side = p > 0 ? RED : -RED
    const x = X(colOf(sq))
    const y = Y(rowOf(sq))
    const color = side === RED ? "#c0271d" : "#1f1f1f"
    out.push(`<g class="piece">`
      + `<circle cx="${x + 1.5}" cy="${y + 3}" r="26" fill="rgba(0,0,0,.35)"/>`
      + `<circle cx="${x}" cy="${y}" r="26" fill="url(#pieceFill)" stroke="#7a4b1e" stroke-width="2"/>`
      + `<circle cx="${x}" cy="${y}" r="21.5" fill="none" stroke="${color}" stroke-width="1.6"/>`
      + `<text x="${x}" y="${y + 1}" fill="${color}" class="pc">${NAMES[side][Math.abs(p)]}</text>`
      + `</g>`)
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f1d39a"/><stop offset=".5" stop-color="#e6bf7a"/><stop offset="1" stop-color="#d9ab62"/>
  </linearGradient>
  <radialGradient id="pieceFill" cx=".4" cy=".35" r=".75">
    <stop offset="0" stop-color="#fff6df"/><stop offset=".7" stop-color="#f2d49c"/><stop offset="1" stop-color="#d8a960"/>
  </radialGradient>
</defs>
${out.join("\n")}
</svg>`
}

/**
 * 生成整页 HTML
 * @param {import("./Game.js").XiangqiGame} game
 * @param {object} info { red, black, title, status, flip }
 */
export function renderHtml(game, { red = "红方", black = "黑方", title = "中国象棋", status = "", flip = false } = {}) {
  const turn = game.result ? 0 : game.side
  const last = game.lastRecord
  const lastText = last ? `${game.moveCount % 2 === 1 ? "红" : "黑"}：${last.cn}` : "尚未走子"
  const player = (side, name) => `<div class="player ${side === RED ? "red" : "black"} ${turn === side ? "active" : ""}">
      <span class="dot"></span><span class="role">${side === RED ? "红方" : "黑方"}</span><span class="name">${escapeHtml(name)}</span>
    </div>`
  const top = flip ? player(RED, red) : player(-RED, black)
  const bottom = flip ? player(-RED, black) : player(RED, red)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #3b2a1a; font-family: ${FONT}; }
#container { width: ${W + 32}px; padding: 16px; background: linear-gradient(160deg, #4a3320, #2c1e12); color: #f6e7c8; }
.bar { display: flex; align-items: center; justify-content: space-between; height: 46px; }
.title { font-size: 22px; font-weight: bold; letter-spacing: 2px; }
.round { font-size: 17px; opacity: .85; }
.player { display: flex; align-items: center; gap: 8px; font-size: 19px; padding: 5px 14px; border-radius: 22px; border: 2px solid transparent; max-width: 70%; }
.player .dot { width: 14px; height: 14px; border-radius: 50%; flex: none; }
.player.red .dot { background: #e0412f; }
.player.black .dot { background: #111; border: 1.5px solid #ddd; }
.player .role { opacity: .8; flex: none; }
.player .name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.player.active { border-color: #f5c14b; background: rgba(245,193,75,.15); }
.player.active::after { content: "走棋中"; font-size: 14px; color: #f5c14b; flex: none; }
.board { border-radius: 6px; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,.5); line-height: 0; margin: 6px 0; }
.foot { display: flex; justify-content: space-between; align-items: center; font-size: 18px; min-height: 34px; }
.status { color: #ffcf5a; font-weight: bold; }
svg text { font-family: ${FONT}; text-anchor: middle; dominant-baseline: central; }
.pc { font-size: 31px; font-weight: bold; }
.river { font-size: 34px; fill: #6b4423; letter-spacing: 6px; }
.label { font-size: 20px; fill: #4a2e14; font-weight: bold; }
.coord { font-size: 14px; fill: #7a5a35; font-family: Consolas, Menlo, monospace !important; }
</style></head><body><div id="container">
  <div class="bar"><span class="title">${escapeHtml(title)}</span><span class="round">第 ${game.round} 回合</span></div>
  <div class="bar">${top}</div>
  <div class="board">${boardSvg(game, flip)}</div>
  <div class="bar">${bottom}</div>
  <div class="foot"><span>上一步　${escapeHtml(lastText)}</span><span class="status">${escapeHtml(status)}</span></div>
</div></body></html>`
}

/** 文字棋盘（puppeteer 不可用时） */
export function renderText(game, flip = false) {
  const pos = game.pos
  const rows = []
  const cols = [...Array(9).keys()].map(dc => (flip ? 8 - dc : dc))
  const head = cols.map(c => "１２３４５６７８９"[c]).join("")
  const foot = cols.map(c => CN_NUM[9 - c]).join("")
  rows.push(flip ? foot : head)
  for (let dr = 0; dr < 10; dr++) {
    const r = flip ? 9 - dr : dr
    if (dr === 5) rows.push("～楚河～～漢界～～")
    rows.push(cols.map(c => {
      const p = pos.board[r * 9 + c]
      return p ? TEXT_NAMES[p > 0 ? RED : -RED][Math.abs(p)] : "＋"
    }).join(""))
  }
  rows.push(flip ? head : foot)
  return rows.join("\n")
}
