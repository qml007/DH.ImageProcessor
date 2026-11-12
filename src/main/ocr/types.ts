export interface OcrModelPaths {
  detectionPath: string
  recognitionPath: string
  dictionaryPath: string
}

/** 一块识别出的文字，坐标已换算到原图像素 */
export interface OcrBlock {
  text: string
  score: number
  x: number
  y: number
  width: number
  height: number
}

export interface OcrRecognition {
  lines: OcrBlock[]
  text: string
  imageWidth: number
  imageHeight: number
}

export interface OcrWorkerRequest {
  id: number
  data: Uint8Array
  ext: string
  width: number
  height: number
}

export interface OcrWorkerResponse {
  id: number
  ok: boolean
  text?: string
  lines?: OcrBlock[]
  message?: string
}

export const OCR_ENGINE = 'rapidocr-ppocrv4'
