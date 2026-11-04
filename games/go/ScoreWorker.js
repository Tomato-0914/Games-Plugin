/** 围棋数子线程：随机模拟估算死子，返回结果后退出 */
import { parentPort, workerData } from "node:worker_threads"
import { analyze } from "./Score.js"

try {
  parentPort.postMessage({ result: analyze(workerData.data) })
} catch (err) {
  parentPort.postMessage({ error: err?.message || String(err) })
}
