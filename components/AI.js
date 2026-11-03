/**
 * AI 调度：在 worker_threads 中运行搜索，避免阻塞 Bot 主线程
 * 同时进行的搜索数受 engine.maxConcurrent 限制，超出的排队
 */
import { Worker } from "node:worker_threads"
import Config from "./Config.js"

const WORKER_FILE = new URL("../games/xiangqi/EngineWorker.js", import.meta.url)
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

function runInWorker(type, data) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(WORKER_FILE, { workerData: { type, data } })
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

/** 线程不可用时在主线程计算 */
async function runInline(type, data) {
  const { think, evaluateFor } = await import("../games/xiangqi/Engine.js")
  return type === "eval" ? evaluateFor(data) : think({ ...data, level: data.level === "困难" ? "普通" : data.level })
}

/**
 * @param {"think" | "eval"} type
 * @param {object} data { fen, moves, level }
 */
export function runEngine(type, data) {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        resolve(await runInWorker(type, data))
      } catch (err) {
        logger?.warn?.(`[Games-Plugin] AI 线程失败，改用主线程：${err.message}`)
        try {
          resolve(await runInline(type, data))
        } catch (err2) {
          reject(err2)
        }
      }
    })
    next()
  })
}
