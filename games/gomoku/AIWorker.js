/** 五子棋 AI 线程：收到一次任务，返回结果后退出 */
import { parentPort, workerData } from "node:worker_threads"
import { think, evaluate } from "./AI.js"

try {
  const { type, data } = workerData
  parentPort.postMessage({ result: type === "eval" ? evaluate(data) : think(data) })
} catch (err) {
  parentPort.postMessage({ error: err?.message || String(err) })
}
