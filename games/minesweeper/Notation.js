/**
 * 扫雷坐标：行字母 + 列数字，例如 C5、c12
 * 支持一次多格：C5 D6、C5,D6、c1c2c3（不用分隔符也可以）
 * 插旗：开头加 旗 / 标 / 插旗 / ! / ！，例如 旗C5、!c1c2
 * 翻开：可以直接写坐标，也可以加 开 / 翻 / 翻开，例如 开C5（官方机器人的“翻开”输入按钮会填入“开”）
 */

const ROWS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const FLAG_PREFIX = /^(插旗|旗|标记|标|!|！)\s*/
const OPEN_PREFIX = /^(翻开|翻|开)\s*/
const BODY = /^(?:[a-z]\d{1,2}[\s,，、]*)+$/i

export const rowName = r => ROWS[r]
export const cellName = (i, cols) => `${ROWS[Math.floor(i / cols)]}${(i % cols) + 1}`

/** 整条消息是否像扫雷操作（不检查是否超出棋盘） */
export function looksLikeOps(text) {
  const t = String(text).trim().replace(/^#\s*/, "").replace(FLAG_PREFIX, "").replace(OPEN_PREFIX, "")
  return BODY.test(t)
}

/**
 * 解析操作
 * @returns {{ flag: boolean, cells: number[] } | { error: string }}
 */
export function parseOps(text, rows, cols, maxBatch = 30) {
  let t = String(text).trim().replace(/^#\s*/, "")
  const flag = FLAG_PREFIX.test(t)
  t = t.replace(FLAG_PREFIX, "")
  if (!flag) t = t.replace(OPEN_PREFIX, "")
  if (!BODY.test(t)) return { error: "看不懂这个坐标，例：C5、旗C5、C5 D6" }
  const cells = []
  for (const [, letter, digits] of t.matchAll(/([a-z])(\d{1,2})/gi)) {
    const r = ROWS.indexOf(letter.toUpperCase())
    const c = Number(digits) - 1
    const name = `${letter.toUpperCase()}${digits}`
    if (r >= rows) return { error: `没有 ${letter.toUpperCase()} 行，行号是 A–${ROWS[rows - 1]}` }
    if (c < 0 || c >= cols) return { error: `${name} 超出范围，列号是 1–${cols}` }
    const i = r * cols + c
    if (!cells.includes(i)) cells.push(i)
  }
  if (cells.length > maxBatch) return { error: `一次最多操作 ${maxBatch} 格` }
  return { flag, cells }
}
