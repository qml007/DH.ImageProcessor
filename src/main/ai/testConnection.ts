import type { AiAdvancedParam } from '../db/aiSettingInfo'

const TEST_TIMEOUT = 15000

// 1×1 透明 PNG，用于探测模型是否接受图像输入
const VISION_TEST_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export interface AiConnectionTestInput {
  baseUrl: string
  apiKey: string
  model: string
  supportsVision: number
  advancedParams: AiAdvancedParam[]
}

export interface AiConnectionTestResult {
  ok: boolean
  message: string
  latencyMs: number
  model?: string
  /** 图像能力探测结果：supported 可用 / unsupported 不接受图像 / not-tested 未勾选 */
  vision: 'supported' | 'unsupported' | 'not-tested'
}

const chatCompletionsUrl = (baseUrl: string): string => {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('Base URL 不能为空')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

/** 高级参数按类型转换后合并进请求体，model / messages 不允许覆盖 */
const buildAdvancedBody = (params: AiAdvancedParam[]): Record<string, unknown> => {
  const body: Record<string, unknown> = {}

  for (const param of params) {
    const key = param.key.trim()
    if (!key || key === 'model' || key === 'messages') continue

    if (param.type === 'number') {
      const value = Number(param.value)
      if (Number.isFinite(value)) body[key] = value
      continue
    }

    if (param.type === 'boolean') {
      body[key] = ['true', '1', 'yes', 'on'].includes(param.value.trim().toLowerCase())
      continue
    }

    body[key] = param.value
  }

  return body
}

const errorSnippet = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string }
    const message = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? '')
    if (message) return message.slice(0, 300)
  } catch {
    // 非 JSON 响应，直接截取原文
  }
  return text.trim().slice(0, 300)
}

const requestChat = async (
  input: AiConnectionTestInput,
  content: unknown
): Promise<{ res: Response; latencyMs: number }> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (input.apiKey.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`

  const body = {
    ...buildAdvancedBody(input.advancedParams),
    model: input.model.trim(),
    messages: [{ role: 'user', content }],
    max_tokens: 1,
    stream: false
  }

  const started = Date.now()
  let response: Response

  try {
    response = await fetch(chatCompletionsUrl(input.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TEST_TIMEOUT)
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`连接超时（${TEST_TIMEOUT / 1000} 秒）`)
    }
    throw new Error(`无法连接 Base URL：${error instanceof Error ? error.message : String(error)}`)
  }

  return { res: response, latencyMs: Date.now() - started }
}

export async function testAiConnection(
  input: AiConnectionTestInput
): Promise<AiConnectionTestResult> {
  if (!input.model.trim()) {
    return { ok: false, message: '模型不能为空', latencyMs: 0, vision: 'not-tested' }
  }

  let latencyMs = 0

  try {
    const { res, latencyMs: textLatency } = await requestChat(input, 'ping')
    latencyMs = textLatency

    if (!res.ok) {
      const detail = await errorSnippet(res)
      return {
        ok: false,
        message: `文本连接失败：HTTP ${res.status}${detail ? `，${detail}` : ''}`,
        latencyMs,
        vision: 'not-tested'
      }
    }

    if (input.supportsVision !== 1) {
      return {
        ok: true,
        message: `连接成功，模型「${input.model.trim()}」可用`,
        latencyMs,
        model: input.model.trim(),
        vision: 'not-tested'
      }
    }

    const vision = await requestChat(input, [
      { type: 'text', text: 'ping' },
      { type: 'image_url', image_url: { url: VISION_TEST_IMAGE } }
    ])

    if (vision.res.ok) {
      return {
        ok: true,
        message: `连接成功，模型「${input.model.trim()}」可用，且接受图像输入`,
        latencyMs: latencyMs + vision.latencyMs,
        model: input.model.trim(),
        vision: 'supported'
      }
    }

    const detail = await errorSnippet(vision.res)
    return {
      ok: true,
      message: `文本连接成功，但图像请求失败：HTTP ${vision.res.status}${detail ? `，${detail}` : ''}，请确认该模型支持图像`,
      latencyMs: latencyMs + vision.latencyMs,
      model: input.model.trim(),
      vision: 'unsupported'
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '测试连接失败',
      latencyMs,
      vision: 'not-tested'
    }
  }
}
