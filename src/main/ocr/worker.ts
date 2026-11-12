import { parentPort, workerData } from 'worker_threads'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import Ocr from '@gutenye/ocr-node'
import type {
  OcrBlock,
  OcrModelPaths,
  OcrWorkerRequest,
  OcrWorkerResponse
} from './types'

interface WorkerData {
  models: OcrModelPaths
}

interface OcrTextLine {
  text: string
  mean?: number
  score?: number
  box: number[][]
}

interface OcrDetectResult {
  texts: OcrTextLine[]
  resizedImageWidth: number
  resizedImageHeight: number
}

interface OcrInstance {
  detect: (path: string) => Promise<OcrDetectResult>
}

interface OcrFactory {
  create: (options: { models: OcrModelPaths }) => Promise<OcrInstance>
}

const { models } = workerData as WorkerData

// @gutenye/ocr-node 是 ESM 包，打包成 CJS 后需要兼容 default 导出
const ocrFactory = (Ocr as unknown as { default?: OcrFactory }).default ?? (Ocr as unknown as OcrFactory)

let ocrPromise: Promise<OcrInstance> | null = null

const getOcr = (): Promise<OcrInstance> => {
  if (!ocrPromise) {
    ocrPromise = ocrFactory.create({ models })
  }
  return ocrPromise
}

const scaleLines = (
  texts: OcrTextLine[],
  resizedWidth: number,
  resizedHeight: number,
  width: number,
  height: number
): OcrBlock[] => {
  const sx = resizedWidth ? width / resizedWidth : 1
  const sy = resizedHeight ? height / resizedHeight : 1

  return texts.map((line) => {
    const xs = line.box.map((point) => point[0])
    const ys = line.box.map((point) => point[1])
    const left = Math.min(...xs) * sx
    const top = Math.min(...ys) * sy
    const right = Math.max(...xs) * sx
    const bottom = Math.max(...ys) * sy

    return {
      text: line.text,
      score: line.mean ?? line.score ?? 0,
      x: left,
      y: top,
      width: Math.max(right - left, 1),
      height: Math.max(bottom - top, 1)
    }
  })
}

const handleRequest = async (request: OcrWorkerRequest): Promise<void> => {
  const { id, data, ext, width, height } = request
  let dir = ''

  try {
    const ocr = await getOcr()
    dir = await mkdtemp(join(tmpdir(), 'dh-ocr-'))
    const file = join(dir, `input.${ext || 'png'}`)
    await writeFile(file, Buffer.from(data))

    const result = await ocr.detect(file)
    const lines = scaleLines(
      result.texts,
      result.resizedImageWidth,
      result.resizedImageHeight,
      width,
      height
    )

    parentPort?.postMessage({
      id,
      ok: true,
      lines,
      text: lines.map((line) => line.text).join('\n')
    } satisfies OcrWorkerResponse)
  } catch (error) {
    parentPort?.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : 'OCR 识别失败'
    } satisfies OcrWorkerResponse)
  } finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

parentPort?.on('message', (request: OcrWorkerRequest) => {
  void handleRequest(request)
})
