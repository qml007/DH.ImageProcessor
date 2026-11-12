import { app, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { OcrModelPaths, OcrRecognition, OcrWorkerResponse } from './types'

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/gif': 'gif'
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<
  number,
  { resolve: (value: OcrRecognition) => void; reject: (error: Error) => void }
>()

// OCR 串行执行，避免多张图同时推理抢占 CPU
let queue: Promise<unknown> = Promise.resolve()

const modelRoot = (): string => {
  const candidates = [
    join(process.resourcesPath, 'ocr'),
    join(process.cwd(), 'node_modules', '@gutenye', 'ocr-models', 'assets'),
    join(app.getAppPath(), 'node_modules', '@gutenye', 'ocr-models', 'assets')
  ]

  return candidates.find((item) => existsSync(item)) ?? candidates[0]
}

const resolveModelPaths = (): OcrModelPaths => {
  const root = modelRoot()
  const models: OcrModelPaths = {
    detectionPath: join(root, 'ch_PP-OCRv4_det_infer.onnx'),
    recognitionPath: join(root, 'ch_PP-OCRv4_rec_infer.onnx'),
    dictionaryPath: join(root, 'ppocr_keys_v1.txt')
  }

  if (!existsSync(models.detectionPath) || !existsSync(models.recognitionPath)) {
    throw new Error('未找到 OCR 模型文件，请检查安装包是否完整')
  }

  return models
}

const failAll = (error: Error): void => {
  for (const item of pending.values()) {
    item.reject(error)
  }
  pending.clear()
}

const ensureWorker = (): Worker => {
  if (worker) return worker

  const created = new Worker(join(__dirname, 'ocrWorker.js'), {
    workerData: { models: resolveModelPaths() }
  })

  created.on('message', (message: OcrWorkerResponse) => {
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)

    if (message.ok) {
      item.resolve({
        lines: message.lines ?? [],
        text: message.text ?? '',
        imageWidth: 0,
        imageHeight: 0
      })
    } else {
      item.reject(new Error(message.message || 'OCR 识别失败'))
    }
  })

  created.on('error', (error) => {
    if (worker === created) worker = null
    failAll(error instanceof Error ? error : new Error('OCR 服务异常'))
  })

  created.on('exit', (code) => {
    if (worker === created) worker = null
    if (code !== 0) failAll(new Error('OCR 服务已退出'))
  })

  worker = created
  return created
}

export const recognizeBuffer = (
  buffer: Buffer,
  ext: string,
  width: number,
  height: number
): Promise<OcrRecognition> => {
  const run = queue.then(
    () =>
      new Promise<OcrRecognition>((resolve, reject) => {
        try {
          const target = ensureWorker()
          const id = nextId
          nextId += 1
          pending.set(id, { resolve, reject })

          const data = new Uint8Array(buffer.byteLength)
          data.set(buffer)

          target.postMessage({ id, data, ext, width, height })
        } catch (error) {
          reject(error instanceof Error ? error : new Error('OCR 识别失败'))
        }
      })
  )

  queue = run.catch(() => undefined)

  return run.then((result) => ({ ...result, imageWidth: width, imageHeight: height }))
}

/** 识别 data URL 表示的图像（整图或已裁剪的区域） */
export const recognizeDataUrl = async (dataUrl: string): Promise<OcrRecognition> => {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(dataUrl.trim())
  if (!match) throw new Error('图片数据格式无效')

  const buffer = Buffer.from(match[2], 'base64')
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) throw new Error('无法解析待识别图像')

  const { width, height } = image.getSize()
  if (!width || !height) throw new Error('待识别图像尺寸无效')

  const ext = MIME_TO_EXT[match[1].toLowerCase()] ?? 'png'
  return recognizeBuffer(buffer, ext, width, height)
}

export const shutdownOcrWorker = (): void => {
  if (!worker) return
  worker.terminate().catch(() => undefined)
  worker = null
  failAll(new Error('OCR 服务已关闭'))
}
