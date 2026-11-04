/**
 * 飞行棋一局：掷骰、可走飞机、移动、撞子、名次
 *
 * 规则：
 * - 掷出 6 才能起飞；掷出 6 可以再掷；连续三次 6 本回合作废
 * - 停在自己颜色的格子跳到下一个同色格（+4）；停在飞行起点沿捷径飞 12 格；一次移动最多跳一次、飞一次
 * - 停在对方飞机所在格（含跳子、飞棋的落点），对方这一格的飞机全部回停机坪；飞棋横穿的对方终点通道格同样撞回
 * - 自己的飞机可以叠在一起；对方叠子不挡路
 * - 终点必须正好走到，多出的步数往回退
 * - 四架都到终点的玩家得到名次；剩最后一位时对局结束（最后一名为输）
 */
import { COLORS, FINISH, OUTER, SHORTCUT, isOwnSquare, loopIndex, shortcutCross } from "./Board.js"

const PLANES = 4

export class FlyingGame {
  /**
   * @param {object} opt
   * @param {number[]} opt.colors 参与的颜色（0 红 1 黄 2 蓝 3 绿），按行动顺序
   * @param {() => number} [opt.dice] 骰子函数，返回 1..6（测试可注入）
   */
  constructor({ colors = [0, 1, 2, 3], dice } = {}) {
    this.colors = [...colors]
    this.pos = Array.from({ length: COLORS }, () => Array(PLANES).fill(-1))
    this.turn = 0 // this.colors 中的下标
    this.roll = 0 // 本次掷出的点数，0 表示还没掷
    this.sixes = 0 // 本回合连续 6 的次数
    this.ranks = [] // 依次到达的颜色
    this.result = null
    this.dice = dice || (() => 1 + Math.floor(Math.random() * 6))
  }

  get color() {
    return this.colors[this.turn]
  }

  finished(color) {
    return this.pos[color].every(p => p === FINISH)
  }

  homeCount(color) {
    return this.pos[color].filter(p => p === FINISH).length
  }

  /** 掷骰子；返回 { roll, voided } —— 第三个 6 本回合作废 */
  rollDice() {
    if (this.result) throw new Error("对局已结束")
    if (this.roll) throw new Error("已经掷过了，请先选择飞机")
    const roll = this.dice()
    if (roll === 6) this.sixes++
    if (roll === 6 && this.sixes >= 3) {
      this.nextTurn()
      return { roll, voided: true }
    }
    this.roll = roll
    return { roll, voided: false }
  }

  /** 当前点数下可以走的飞机编号（0..3） */
  movablePlanes() {
    if (!this.roll) return []
    const list = []
    this.pos[this.color].forEach((p, k) => {
      if (p === FINISH) return
      if (p < 0 && this.roll !== 6) return
      list.push(k)
    })
    return list
  }

  /** 走法相同的飞机只保留一架（同在停机坪或叠在同一格） */
  distinctMoves() {
    const seen = new Set()
    return this.movablePlanes().filter(k => {
      const p = this.pos[this.color][k]
      if (seen.has(p)) return false
      seen.add(p)
      return true
    })
  }

  /** 把 color 停在 pos 上时撞到的对方飞机：返回 [{ color, plane }] */
  hitsAt(color, pos) {
    if (pos < 1 || pos > OUTER) return []
    const idx = loopIndex(color, pos)
    const hits = []
    for (const c of this.colors) {
      if (c === color) continue
      this.pos[c].forEach((p, k) => {
        if (p >= 1 && p <= OUTER && loopIndex(c, p) === idx) hits.push({ color: c, plane: k })
      })
    }
    return hits
  }

  sendHome(hits) {
    for (const h of hits) this.pos[h.color][h.plane] = -1
  }

  /**
   * 预演一步（不改变局面）：返回走完后的位置和过程
   * @returns {{ to, steps: string[], hits: { color, plane }[], takeoff, finish }}
   */
  preview(plane) {
    const color = this.color
    const from = this.pos[color][plane]
    const roll = this.roll
    const info = { from, to: from, steps: [], hits: [], takeoff: false, finish: false, jumped: false, flew: false }
    if (from < 0) {
      info.to = 0
      info.takeoff = true
      return info
    }
    let p = from + roll
    if (p > FINISH) {
      p = FINISH * 2 - p
      info.steps.push("bounce")
    }
    const stop = q => info.hits.push(...this.hitsAt(color, q).filter(h => !info.hits.some(x => x.color === h.color && x.plane === h.plane)))
    stop(p)
    // 跳一次、飞一次
    for (;;) {
      if (p === SHORTCUT.from && !info.flew) {
        const cross = shortcutCross(color)
        if (this.colors.includes(cross.color)) {
          this.pos[cross.color].forEach((q, k) => {
            if (q === cross.pos) info.hits.push({ color: cross.color, plane: k })
          })
        }
        p = SHORTCUT.to
        info.flew = true
        info.steps.push("fly")
        stop(p)
        continue
      }
      if (isOwnSquare(p) && p + 4 <= OUTER && !info.jumped) {
        p += 4
        info.jumped = true
        info.steps.push("jump")
        stop(p)
        continue
      }
      break
    }
    info.to = p
    info.finish = p === FINISH
    return info
  }

  /**
   * 走一架飞机
   * @returns {object} preview 信息 + { again: 是否再掷一次, rank: 新得到的名次 }
   */
  move(plane) {
    if (!this.movablePlanes().includes(plane)) throw new Error("这架飞机现在不能走")
    const color = this.color
    const info = this.preview(plane)
    this.sendHome(info.hits)
    this.pos[color][plane] = info.to
    const roll = this.roll
    this.roll = 0
    if (this.finished(color) && !this.ranks.includes(color)) {
      this.ranks.push(color)
      info.rank = this.ranks.length
    }
    this.checkEnd()
    // 掷出 6 再掷一次（已经全部到达的除外）
    info.again = !this.result && roll === 6 && !this.finished(color)
    if (!info.again) this.nextTurn()
    return info
  }

  /** 没有可走的飞机：跳过（掷出 6 仍可再掷） */
  skip() {
    const again = this.roll === 6 && !this.finished(this.color)
    this.roll = 0
    if (!again) this.nextTurn()
    return { again }
  }

  nextTurn() {
    this.roll = 0
    this.sixes = 0
    if (this.result) return
    for (let k = 0; k < this.colors.length; k++) {
      this.turn = (this.turn + 1) % this.colors.length
      if (!this.finished(this.color)) return
    }
  }

  checkEnd() {
    const left = this.colors.filter(c => !this.ranks.includes(c))
    if (left.length <= 1) {
      this.ranks.push(...left)
      this.result = { ranks: [...this.ranks] }
    }
  }

  toJSON() {
    return { colors: this.colors, pos: this.pos, turn: this.turn, roll: this.roll, sixes: this.sixes, ranks: this.ranks, result: this.result }
  }

  static fromJSON(data, dice) {
    const g = new FlyingGame({ colors: data.colors, dice })
    g.pos = data.pos.map(a => [...a])
    g.turn = data.turn
    g.roll = data.roll
    g.sixes = data.sixes
    g.ranks = [...data.ranks]
    g.result = data.result
    return g
  }
}

/**
 * 机器人选飞机：撞子 > 到终点 > 起飞 > 避开对方 1–6 格内 > 走得远
 */
export function chooseMove(game) {
  const color = game.color
  const options = game.distinctMoves()
  if (!options.length) return -1
  let best = options[0]
  let bestScore = -Infinity
  for (const k of options) {
    const info = game.preview(k)
    let score = 0
    score += info.hits.length * 120
    if (info.finish) score += 100
    if (info.takeoff) score += 60
    if (info.flew) score += 30
    if (info.jumped) score += 15
    // 危险：落点后方 1–6 格内有对方飞机
    if (info.to >= 1 && info.to <= OUTER) {
      const idx = loopIndex(color, info.to)
      for (const c of game.colors) {
        if (c === color) continue
        for (const p of game.pos[c]) {
          if (p < 1 || p > OUTER) continue
          const d = (idx - loopIndex(c, p) + 52) % 52
          if (d >= 1 && d <= 6) score -= 25
        }
      }
    }
    // 已在终点通道里的飞机不急着走
    if (info.from > OUTER) score -= 10
    score += (info.to - Math.max(info.from, 0)) * 0.5
    if (score > bestScore) {
      bestScore = score
      best = k
    }
  }
  return best
}
