/**
 * 飞行棋棋盘几何（15×15 十字形棋盘）
 *
 *   外圈 52 格（LOOP，顺时针），四种颜色依次循环
 *   每种颜色：起点在外圈上，走 50 格后拐进 5 格终点通道，第 6 步到中心终点
 *
 * 飞机位置 pos（以该颜色自己的路线计）：
 *   -1        停机坪
 *    0        起飞点（停机坪旁，安全）
 *    1..50    外圈（loopIndex = (START[color] + pos - 1) % 52）
 *   51..55    终点通道
 *   56        终点（中心）
 *
 * 自己颜色的格子：pos = 1, 5, 9 … 49（每 4 格一个）
 * 飞行捷径：pos 5 → pos 17（12 格），横穿下一位玩家的终点通道末端
 */

export const COLORS = 4
export const COLOR_NAMES = ["红", "黄", "蓝", "绿"]
export const COLOR_HEX = ["#e53935", "#f9b31a", "#1e88e5", "#43a047"]
export const LOOP_LEN = 52
export const OUTER = 50
export const FINISH = 56
export const SHORTCUT = { from: 5, to: 17 }

/** 外圈 52 格坐标（x, y），从左臂上沿最左格开始顺时针 */
export const LOOP = (() => {
  const cells = []
  for (let x = 0; x <= 5; x++) cells.push([x, 6]) // 左臂上沿 →
  for (let y = 5; y >= 0; y--) cells.push([6, y]) // 上臂左列 ↑
  cells.push([7, 0]) // 上端
  for (let y = 0; y <= 5; y++) cells.push([8, y]) // 上臂右列 ↓
  for (let x = 9; x <= 14; x++) cells.push([x, 6]) // 右臂上沿 →
  cells.push([14, 7]) // 右端
  for (let x = 14; x >= 9; x--) cells.push([x, 8]) // 右臂下沿 ←
  for (let y = 9; y <= 14; y++) cells.push([8, y]) // 下臂右列 ↓
  cells.push([7, 14]) // 下端
  for (let y = 14; y >= 9; y--) cells.push([6, y]) // 下臂左列 ↑
  for (let x = 5; x >= 0; x--) cells.push([x, 8]) // 左臂下沿 ←
  cells.push([0, 7]) // 左端
  return cells
})()

/** 各颜色起点在外圈上的序号：红左上、黄右上、蓝右下、绿左下 */
export const START = [2, 15, 28, 41]

/** 外圈格子的颜色 */
export const loopColor = i => (((i - 2) % 4) + 4) % 4

/** 各颜色终点通道 5 格 + 中心 */
export const HOME = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
]
export const CENTER = [7, 7]

/** 停机坪（4 个机位）与起飞点 */
export const HANGAR = [
  { box: [0, 0], spots: [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]], takeoff: [1, 5] },
  { box: [9, 0], spots: [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]], takeoff: [9, 1] },
  { box: [9, 9], spots: [[12.5, 12.5], [10.5, 12.5], [12.5, 10.5], [10.5, 10.5]], takeoff: [13, 9] },
  { box: [0, 9], spots: [[3.5, 12.5], [1.5, 12.5], [3.5, 10.5], [1.5, 10.5]], takeoff: [5, 13] },
]

export const loopIndex = (color, pos) => (START[color] + pos - 1) % LOOP_LEN

/** 是否是自己颜色的外圈格 */
export const isOwnSquare = pos => pos >= 1 && pos <= OUTER && (pos - 1) % 4 === 0

/** 飞机所在格子坐标（停机坪返回机位坐标） */
export function cellOf(color, pos, plane = 0) {
  if (pos < 0) return HANGAR[color].spots[plane]
  if (pos === 0) return HANGAR[color].takeoff
  if (pos <= OUTER) return LOOP[loopIndex(color, pos)]
  if (pos < FINISH) return HOME[color][pos - OUTER - 1]
  return CENTER
}

/**
 * 飞行捷径横穿的格子：下一位玩家终点通道的最后一格
 * 例如红从上臂左列底部飞到右列底部，经过黄的终点通道 (7,5)
 */
export const shortcutCross = color => ({ color: (color + 1) % COLORS, pos: FINISH - 1 })
