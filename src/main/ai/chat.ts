import type { AiSettingInfoRow } from '../db/aiSettingInfo'
import { buildAdvancedBody, chatCompletionsUrl } from './testConnection'

export interface AiChatMessageInput {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** data:image/...;base64,... 形式的图片，仅 vision 服务会带上 */
  images?: string[]
}

const toApiMessage = (message: AiChatMessageInput): Record<string, unknown> => {
  const images = (message.images ?? []).filter((url) => url.startsWith('data:image/'))

  if (!images.length) return { role: message.role, content: message.content }

  return {
    role: message.role,
    content: [
      { type: 'text', text: message.content },
      ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
    ]
  }
}

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
}

/**
 * 调用 OpenAI 兼容接口并逐段回调文本增量。
 * 服务不支持 SSE 时退化为一次性返回，仍然通过 onDelta 输出。
 */
export async function streamChatCompletion(
  setting: AiSettingInfoRow,
  messages: AiChatMessageInput[],
  signal: AbortSignal,
  onDelta: (text: string) => void
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  }
  if (setting.apiKey) headers.Authorization = `Bearer ${setting.apiKey}`

  const response = await fetch(chatCompletionsUrl(setting.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...buildAdvancedBody(setting.advancedParams),
      model: setting.model,
      messages: messages.map(toApiMessage),
      stream: true
    }),
    signal
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`请求失败：HTTP ${response.status}${detail ? `，${detail.slice(0, 300)}` : ''}`)
  }

  const contentType = response.headers.get('content-type') ?? ''

  // 部分服务忽略 stream 参数，直接返回完整 JSON
  if (!contentType.includes('text/event-stream')) {
    const raw = await response.text()
    let parsed: StreamChunk
    try {
      parsed = JSON.parse(raw) as StreamChunk
    } catch {
      throw new Error('该服务未返回可识别的响应')
    }
    const text = parsed.choices?.[0]?.message?.content
    if (!text) throw new Error('响应中没有文本内容')
    onDelta(text)
    return
  }

  if (!response.body) throw new Error('服务未返回响应流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')

      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      if (data === '[DONE]') {
        finished = true
        break
      }

      try {
        const parsed = JSON.parse(data) as StreamChunk
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) onDelta(delta)
      } catch {
        // 忽略无法解析的心跳或非标准片段
      }
    }
  }
}
