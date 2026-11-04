/**
 * 飞行棋棋盘渲染
 */
import { LOOP, START, HOME, HANGAR, COLOR_HEX, COLOR_NAMES, FINISH, loopColor, cellOf, SHORTCUT } from "./Board.js"

const FONT = `"ChessKai","KaiTi","STKaiti","Noto Serif CJK SC","WenQuanYi Zen Hei","Microsoft YaHei",serif`
const CELL = 42
const PAD = 14
const W = CELL * 15 + PAD * 2
const TINT = ["#fbd3d1", "#fdebb8", "#cfe3f8", "#d3ecd4"]
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch])

const cx = x => PAD + (x + 0.5) * CELL
const cy = y => PAD + (y + 0.5) * CELL
const FINISH_SPOT = [[6.25, 7], [7, 6.25], [7.75, 7], [7, 7.75]]

/** 骰子图案 */
export function diceSvg(n, size = 34) {
  const pips = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] }[n] || []
  const s = size / 4
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="6" fill="#fff" stroke="#333" stroke-width="1.5"/>${pips.map(([x, y]) => `<circle cx="${s * (x + 1)}" cy="${s * (y + 1)}" r="${size / 11}" fill="${n === 1 ? "#d32f2f" : "#222"}"/>`).join("")}</svg>`
}

function boardSvg(game, { highlight = [] } = {}) {
  const out = []
  out.push(`<rect x="0" y="0" width="${W}" height="${W}" rx="10" fill="#fffdf6"/>`)
  // 停机坪
  HANGAR.forEach((h, c) => {
    const [bx, by] = h.box
    const active = game.colors.includes(c)
    out.push(`<rect x="${PAD + bx * CELL + 4}" y="${PAD + by * CELL + 4}" width="${CELL * 6 - 8}" height="${CELL * 6 - 8}" rx="14" fill="${active ? TINT[c] : "#eee"}" stroke="${COLOR_HEX[c]}" stroke-width="3"/>`)
    for (const [sx, sy] of h.spots) out.push(`<circle cx="${PAD + sx * CELL}" cy="${PAD + sy * CELL}" r="${CELL * 0.48}" fill="#fff" stroke="${COLOR_HEX[c]}" stroke-width="2" opacity=".85"/>`)
    const [tx, ty] = h.takeoff
    out.push(`<circle cx="${cx(tx)}" cy="${cy(ty)}" r="${CELL * 0.42}" fill="#fff" stroke="${COLOR_HEX[c]}" stroke-width="2" stroke-dasharray="4 3"/>`)
    out.push(`<text x="${cx(tx)}" y="${cy(ty)}" class="small" fill="${COLOR_HEX[c]}">起飞</text>`)
  })
  // 外圈
  LOOP.forEach(([x, y], i) => {
    const c = loopColor(i)
    const start = START.indexOf(i)
    out.push(`<rect x="${PAD + x * CELL + 1.5}" y="${PAD + y * CELL + 1.5}" width="${CELL - 3}" height="${CELL - 3}" rx="5" fill="${TINT[c]}" stroke="${COLOR_HEX[c]}" stroke-width="${start >= 0 ? 3 : 1.2}"/>`)
  })
  // 终点通道与中心
  HOME.forEach((cells, c) => {
    for (const [x, y] of cells) out.push(`<rect x="${PAD + x * CELL + 1.5}" y="${PAD + y * CELL + 1.5}" width="${CELL - 3}" height="${CELL - 3}" rx="5" fill="${COLOR_HEX[c]}" opacity=".75"/>`)
  })
  const L = PAD + 6 * CELL
  const R = PAD + 9 * CELL
  const M = PAD + 7.5 * CELL
  const tri = [[L, L, L, R], [L, L, R, L], [R, L, R, R], [L, R, R, R]]
  tri.forEach(([x1, y1, x2, y2], c) => out.push(`<polygon points="${x1},${y1} ${x2},${y2} ${M},${M}" fill="${COLOR_HEX[c]}" opacity=".85" stroke="#fff" stroke-width="2"/>`))
  // 飞行捷径
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = cellOf(c, SHORTCUT.from)
    const [bx, by] = cellOf(c, SHORTCUT.to)
    out.push(`<line x1="${cx(ax)}" y1="${cy(ay)}" x2="${cx(bx)}" y2="${cy(by)}" stroke="${COLOR_HEX[c]}" stroke-width="3.5" stroke-dasharray="7 5" marker-end="url(#arrow${c})"/>`)
  }
  // 飞机：同一格的合并显示
  const groups = new Map()
  for (const c of game.colors) {
    game.pos[c].forEach((p, k) => {
      let at
      if (p < 0) at = HANGAR[c].spots[k].map(v => v - 0.5) // 机位坐标是圆心
      else if (p === FINISH) at = FINISH_SPOT[c].map(v => v - 0.5)
      else at = cellOf(c, p)
      const key = `${c}|${at.join()}`
      if (!groups.has(key)) groups.set(key, { c, at, planes: [] })
      groups.get(key).planes.push(k)
    })
  }
  const hl = new Set(highlight)
  for (const { c, at, planes } of groups.values()) {
    const [x, y] = at
    const px = PAD + (x + 0.5) * CELL
    const py = PAD + (y + 0.5) * CELL
    const label = planes.map(k => k + 1).join("")
    const r = CELL * 0.4
    if (planes.some(k => hl.has(k)) && c === game.color) out.push(`<circle cx="${px}" cy="${py}" r="${r + 5}" fill="none" stroke="#ffb300" stroke-width="4"/>`)
    out.push(`<circle cx="${px + 1.5}" cy="${py + 2.5}" r="${r}" fill="rgba(0,0,0,.25)"/>`)
    out.push(`<circle cx="${px}" cy="${py}" r="${r}" fill="${COLOR_HEX[c]}" stroke="#fff" stroke-width="2.5"/>`)
    out.push(`<text x="${px}" y="${py + 1}" class="plane" font-size="${label.length > 2 ? 12 : label.length > 1 ? 15 : 19}">${label}</text>`)
  }
  const arrows = COLOR_HEX.map((hex, c) => `<marker id="arrow${c}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${hex}"/></marker>`).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><defs>${arrows}</defs>${out.join("\n")}</svg>`
}

/**
 * @param {import("./Game.js").FlyingGame} game
 * @param {object} info { players: [{ color, name, tag }], title, last, roll, status, highlight, fontUrl }
 */
export function renderHtml(game, { players = [], title = "飞行棋", last = "", roll = 0, status = "", highlight = [], fontUrl = "" } = {}) {
  const current = game.result ? -1 : game.color
  const items = players.map(p => {
    const rank = game.ranks.indexOf(p.color)
    const lose = game.result && rank === game.ranks.length - 1
    const badge = rank >= 0 ? `<span class="rank ${lose ? "lose" : ""}">${lose ? "最后" : `第${rank + 1}名`}</span>` : `<span class="home">到达 ${game.homeCount(p.color)}/4</span>`
    return `<div class="player ${p.color === current ? "active" : ""}"><span class="dot" style="background:${COLOR_HEX[p.color]}"></span>
      <span class="role">${COLOR_NAMES[p.color]}</span><span class="name">${esc(p.name)}</span>${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ""}${badge}</div>`
  }).join("")
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
${fontUrl ? `@font-face { font-family: "ChessKai"; src: url("${fontUrl}") format("woff2"); font-display: block; }` : ""}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #2c2c2c; font-family: ${FONT}; }
#container { width: ${W + 32}px; padding: 16px; color: #f2f2f2; background: linear-gradient(160deg, #3d3d3d, #1f1f1f); }
.bar { display: flex; align-items: center; justify-content: space-between; min-height: 40px; }
.title { font-size: 24px; font-weight: bold; letter-spacing: 2px; }
.players { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 6px 0 10px; }
.player { display: flex; align-items: center; gap: 7px; font-size: 17px; padding: 5px 12px; border-radius: 20px; border: 2px solid rgba(255,255,255,.12); min-width: 0; }
.player .dot { width: 15px; height: 15px; border-radius: 50%; flex: none; }
.player .role { opacity: .8; flex: none; }
.player .name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.player .tag { font-size: 13px; padding: 0 6px; border-radius: 8px; background: rgba(255,255,255,.15); flex: none; }
.player .home { margin-left: auto; font-size: 14px; opacity: .8; flex: none; }
.player .rank { margin-left: auto; font-size: 14px; color: #ffd54f; font-weight: bold; flex: none; }
.player .rank.lose { color: #ef9a9a; }
.player.active { border-color: #f5c14b; background: rgba(245,193,75,.14); }
.board { line-height: 0; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.55); }
.foot { display: flex; align-items: center; gap: 10px; font-size: 18px; min-height: 40px; margin-top: 10px; }
.foot .text { flex: 1; }
.status { color: #ffcf5a; font-weight: bold; }
svg text { font-family: ${FONT}; text-anchor: middle; dominant-baseline: central; }
.plane { fill: #fff; font-weight: bold; font-family: Consolas, Menlo, monospace !important; }
.small { font-size: 12px; font-weight: bold; }
</style></head><body><div id="container">
  <div class="bar"><span class="title">${esc(title)}</span><span class="status">${esc(status)}</span></div>
  <div class="players">${items}</div>
  <div class="board">${boardSvg(game, { highlight })}</div>
  <div class="foot">${roll ? diceSvg(roll) : ""}<span class="text">${esc(last)}</span></div>
</div></body></html>`
}

/** 文字版（截图失败时） */
export function renderText(game, players) {
  return players.map(p => {
    const where = game.pos[p.color].map((pos, k) => `${k + 1}号:${pos < 0 ? "机坪" : pos === 0 ? "起飞点" : pos === FINISH ? "终点" : pos > 50 ? `终点通道${pos - 50}` : `第${pos}格`}`)
    return `${COLOR_NAMES[p.color]} ${p.name}：${where.join(" ")}`
  }).join("\n")
}
