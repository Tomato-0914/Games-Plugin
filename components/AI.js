/**
 * AI 调度：在 worker_threads 中运行搜索，避免阻塞 Bot 主线程
 * 同时进行的搜索数受 engine.maxConcurrent 限制，超出的排队
 */
import { Worker } from "node:worker_threads"
import Config from "./Config.js"

/** 各游戏的 AI 线程文件与主线程降级实现 */
const ENGINES = {
  xiangqi: {
    worker: new URL("../games/xiangqi/EngineWorker.js", import.meta.url),
    async inline(type, data) {
      const { think, evaluateFor } = await import("../games/xiangqi/Engine.js")
      return type === "eval" ? evaluateFor(data) : think({ ...data, level: data.level === "困难" ? "普通" : data.level })
    },
  },
  go: {
    // 围棋没有 AI，只用线程做终局数子估算
    worker: new URL("../games/go/ScoreWorker.js", import.meta.url),
    async inline(type, data) {
      const { analyze } = await import("../games/go/Score.js")
      return analyze(data)
    },
  },
  gomoku: {
    worker: new URL("../games/gomoku/AIWorker.js", import.meta.url),
    async inline(type, data) {
      const { think, evaluate } = await import("../games/gomoku/AI.js")
      return type === "eval" ? evaluate(data) : think(data)
    },
  },
}
const HARD_TIMEOUT = 30 * 1000

let running = 0
const queue = []

function next() {
  const max = Math.max(1, Number(Config.engine?.maxConcurrent) || 1)
  while (running < max && queue.length) {
    const job = queue.shift()
    running++
    job().finally(() => {
      running--
      next()
    })
  }
}

function runInWorker(engine, type, data) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(engine.worker, { workerData: { type, data } })
    } catch (err) {
      reject(err)
      return
    }
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error("AI 思考超时"))
    }, HARD_TIMEOUT)
    worker.once("message", msg => {
      clearTimeout(timer)
      worker.terminate()
      if (msg.error) reject(new Error(msg.error))
      else resolve(msg.result)
    })
    worker.once("error", err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * @param {"think" | "eval"} type
 * @param {object} data 各游戏自己的参数（象棋 { fen, moves, level }，五子棋 { moves, rules, level }）
 * @param {"xiangqi" | "gomoku" | "go"} [game]
 */
export function runEngine(type, data, game = "xiangqi") {
  const engine = ENGINES[game]
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        resolve(await runInWorker(engine, type, data))
      } catch (err) {
        logger?.warn?.(`[Games-Plugin] AI 线程失败，改用主线程：${err.message}`)
        try {
          resolve(await engine.inline(type, data))
        } catch (err2) {
          reject(err2)
        }
      }
    })
    next()
  })
}
