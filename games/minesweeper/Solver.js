/**
 * 扫雷求解器：只根据可见信息（已翻开的数字）推理哪些格子一定安全、哪些一定是雷
 * 用途：生成无猜棋盘、#扫雷提示
 *
 * 推理规则（依次尝试，有进展就重新开始）：
 *   1. 单格：数字 = 周围已知雷数 → 其余都安全；数字 - 已知雷数 = 未知格数 → 都是雷
 *   2. 两格：两个数字的未知格有包含/重叠关系时，用差集推理（经典的 1-1、1-2 定式）
 *   3. 全局：剩余雷数为 0 或等于剩余未知格数
 *   4. 枚举：前沿（与数字相邻的未知格）按连通块枚举所有可能的雷分布，结合剩余雷数，
 *      在所有分布中都安全/都是雷的格子即可确定（块太大时跳过）
 */
import { Minefield, layMines, rng } from "./Board.js"

const MAX_ENUM = 24 // 单个连通块最多枚举的格子数

/**
 * @param {Minefield} f
 * @param {object} [opt] { knownMines: Uint8Array } 可传入之前推出的雷，加快推理
 * @returns {{ safe: number[], mines: Uint8Array }}
 */
export function deduce(f, { knownMines } = {}) {
  const { total, nb, open, count } = f
  const mine = knownMines ? Uint8Array.from(knownMines) : new Uint8Array(total)
  const safe = new Uint8Array(total)
  const found = []
  const markSafe = i => {
    if (!safe[i] && !open[i] && !mine[i]) {
      safe[i] = 1
      found.push(i)
      return true
    }
    return false
  }
  const markMine = i => {
    if (!mine[i] && !safe[i] && !open[i]) {
      mine[i] = 1
      return true
    }
    return false
  }

  /** 当前约束：每个已翻开的数字 → { cells: 未知格, need: 还差几颗雷 } */
  const constraints = () => {
    const list = []
    for (let i = 0; i < total; i++) {
      if (!open[i] || !count[i]) continue
      const cells = []
      let need = count[i]
      for (const j of nb[i]) {
        if (open[j] || safe[j]) continue
        if (mine[j]) need--
        else cells.push(j)
      }
      if (cells.length) list.push({ cells, need })
    }
    return list
  }

  for (let guard = 0; guard < 10000; guard++) {
    let progress = false
    const list = constraints()

    // 规则 1
    for (const { cells, need } of list) {
      if (need === 0) for (const j of cells) progress = markSafe(j) || progress
      else if (need === cells.length) for (const j of cells) progress = markMine(j) || progress
    }
    if (progress) continue

    // 规则 2：按格子建立索引，只比较有公共格的约束
    const byCell = new Map()
    list.forEach((c, k) => c.cells.forEach(j => (byCell.get(j) || byCell.set(j, []).get(j)).push(k)))
    const sets = list.map(c => new Set(c.cells))
    outer: for (let a = 0; a < list.length; a++) {
      const peers = new Set()
      for (const j of list[a].cells) for (const k of byCell.get(j)) if (k !== a) peers.add(k)
      for (const b of peers) {
        const A = list[a]
        const B = list[b]
        const onlyB = B.cells.filter(j => !sets[a].has(j))
        const onlyA = A.cells.filter(j => !sets[b].has(j))
        const d = B.need - A.need
        // B 比 A 多出的格子恰好要放下全部差值：多出的都是雷，A 独有的都安全
        if (onlyB.length && d === onlyB.length) {
          for (const j of onlyB) progress = markMine(j) || progress
          for (const j of onlyA) progress = markSafe(j) || progress
        } else if (!onlyA.length && onlyB.length && d === 0) {
          // A 包含于 B 且雷数相同：B 多出的都安全
          for (const j of onlyB) progress = markSafe(j) || progress
        }
        if (progress) break outer
      }
    }
    if (progress) continue

    // 规则 3
    let knownMine = 0
    const unknown = []
    for (let i = 0; i < total; i++) {
      if (mine[i]) knownMine++
      else if (!open[i] && !safe[i]) unknown.push(i)
    }
    const left = f.mines - knownMine
    if (unknown.length) {
      if (left === 0) for (const j of unknown) progress = markSafe(j) || progress
      else if (left === unknown.length) for (const j of unknown) progress = markMine(j) || progress
    }
    if (progress) continue

    // 规则 4
    if (enumerate(list, unknown, left, markSafe, markMine)) continue
    break
  }
  return { safe: found, mines: mine }
}

/** 枚举前沿各连通块的所有雷分布 */
function enumerate(list, unknown, left, markSafe, markMine) {
  if (!list.length) return false
  // 连通块：共享格子的约束归为一块
  const parent = list.map((_, i) => i)
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const owner = new Map()
  list.forEach((c, k) => c.cells.forEach(j => {
    if (owner.has(j)) parent[find(k)] = find(owner.get(j))
    else owner.set(j, k)
  }))
  const groups = new Map()
  list.forEach((c, k) => (groups.get(find(k)) || groups.set(find(k), []).get(find(k))).push(c))

  const frontier = new Set(owner.keys())
  const others = unknown.filter(j => !frontier.has(j)).length
  const blocks = []
  for (const cons of groups.values()) {
    const cells = [...new Set(cons.flatMap(c => c.cells))]
    if (cells.length > MAX_ENUM) return false
    const index = new Map(cells.map((j, i) => [j, i]))
    const cs = cons.map(c => ({ idx: c.cells.map(j => index.get(j)), need: c.need }))
    const byVar = cells.map(() => [])
    cs.forEach((c, k) => c.idx.forEach(v => byVar[v].push(k)))
    // 按雷数统计：每种雷数下各格是雷的次数
    const stats = new Map() // mines -> { n, hits: Float64Array }
    const assign = new Int8Array(cells.length).fill(-1)
    const placed = cs.map(() => 0)
    const open_ = cs.map(c => c.idx.length)
    const dfs = (v, m) => {
      if (v === cells.length) {
        let s = stats.get(m)
        if (!s) stats.set(m, (s = { n: 0, hits: new Float64Array(cells.length) }))
        s.n++
        for (let i = 0; i < cells.length; i++) if (assign[i]) s.hits[i]++
        return
      }
      for (const val of [0, 1]) {
        let ok = true
        for (const k of byVar[v]) {
          const p = placed[k] + val
          const rest = open_[k] - 1
          if (p > cs[k].need || p + rest < cs[k].need) { ok = false; break }
        }
        if (!ok) continue
        assign[v] = val
        for (const k of byVar[v]) { placed[k] += val; open_[k]-- }
        dfs(v + 1, m + val)
        for (const k of byVar[v]) { placed[k] -= val; open_[k]++ }
        assign[v] = -1
      }
    }
    dfs(0, 0)
    if (!stats.size) return false
    blocks.push({ cells, stats })
  }

  // 结合剩余雷数：块之间的雷数组合必须满足 总和 ≤ left 且 left - 总和 ≤ 其他未知格数
  // 对每个块，找出与其他块能组合成合法总数的雷数取值
  const ranges = blocks.map(b => [...b.stats.keys()])
  let progress = false
  blocks.forEach((b, bi) => {
    // 其他块雷数之和可能取到的值
    let sums = new Set([0])
    blocks.forEach((_, oi) => {
      if (oi === bi) return
      const next = new Set()
      for (const s of sums) for (const m of ranges[oi]) next.add(s + m)
      sums = next
    })
    const validM = ranges[bi].filter(m => [...sums].some(s => m + s <= left && left - m - s <= others))
    if (!validM.length) return
    for (let i = 0; i < b.cells.length; i++) {
      let always = true
      let never = true
      for (const m of validM) {
        const s = b.stats.get(m)
        if (s.hits[i] !== s.n) always = false
        if (s.hits[i] !== 0) never = false
      }
      if (always) progress = markMine(b.cells[i]) || progress
      else if (never) progress = markSafe(b.cells[i]) || progress
    }
  })
  // 前沿以外的格子：若所有合法组合下剩余雷数都为 0，则都安全
  if (!progress && others) {
    let sums = new Set([0])
    for (const r of ranges) {
      const next = new Set()
      for (const s of sums) for (const m of r) next.add(s + m)
      sums = next
    }
    const rest = [...sums].filter(s => s <= left && left - s <= others).map(s => left - s)
    if (rest.length && rest.every(x => x === 0)) {
      for (const j of unknown) if (!frontier.has(j)) progress = markSafe(j) || progress
    }
  }
  return progress
}

/** 只靠推理能否从 first 开始扫完 */
export function solvable(rows, cols, mines, mineList, first) {
  const f = new Minefield({ rows, cols, mines, mineList })
  f.floodOpen(first)
  let knownMines
  for (;;) {
    if (f.openCount === f.total - mines) return true
    const res = deduce(f, { knownMines })
    knownMines = res.mines
    if (!res.safe.length) return false
    for (const i of res.safe) f.floodOpen(i)
  }
}

/**
 * 生成雷的位置
 * @returns {{ mineList: number[], noGuess: boolean, attempts: number, time: number }}
 */
export function generate({ rows, cols, mines, first, noGuess = true, timeBudget = 3000, seed = Date.now() }) {
  const random = rng(seed)
  const start = Date.now()
  let attempts = 0
  let mineList
  do {
    attempts++
    mineList = layMines(rows, cols, mines, first, random)
    if (!noGuess || solvable(rows, cols, mines, mineList, first)) {
      return { mineList, noGuess, attempts, time: Date.now() - start }
    }
  } while (Date.now() - start < timeBudget)
  return { mineList, noGuess: false, attempts, time: Date.now() - start }
}
