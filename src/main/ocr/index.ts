import { getArcImageOcr, saveArcImageOcr } from '../db/arcImageOcr'
import { recognizeDataUrl } from './service'
import { OCR_ENGINE, type OcrBlock, type OcrRecognition } from './types'

const parseBlocks = (json: string): OcrBlock[] => {
  try {
    const value = JSON.parse(json)
    return Array.isArray(value) ? (value as OcrBlock[]) : []
  } catch {
    return []
  }
}

/** 整图识别：优先复用数据库缓存，未识别过则执行 OCR 并落库 */
export async function recognizeImageWithCache(
  imageId: string,
  historyId: string,
  dataUrl: string
): Promise<OcrRecognition> {
  const cached = getArcImageOcr(imageId, historyId)
  if (cached) {
    return {
      lines: parseBlocks(cached.blocksJson),
      text: cached.text,
      imageWidth: cached.imageWidth,
      imageHeight: cached.imageHeight
    }
  }

  const result = await recognizeDataUrl(dataUrl)

  saveArcImageOcr({
    imageId,
    historyId,
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    text: result.text,
    blocksJson: JSON.stringify(result.lines),
    engine: OCR_ENGINE
  })

  return result
}

export { recognizeDataUrl, shutdownOcrWorker } from './service'
