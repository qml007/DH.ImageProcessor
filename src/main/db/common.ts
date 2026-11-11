// ---------- batInfo 状态常量 ----------
export const BAT_STATUS_IN_PROGRESS = 0
export const BAT_STATUS_COMPLETED = 1

// ---------- 雪花 ID（单机版，无机器码，无查重） ----------
// 相对毫秒时间戳 × 200 + 序列号（每毫秒 200 个容量）
// 上限 (2^41-1) × 200 + 199 ≈ 4.4×10^14，远小于 Number.MAX_SAFE_INTEGER，十进制最长 15 位
const CUSTOM_EPOCH = 1767225600000 // 2026-01-01T00:00:00.000Z，约可用 69 年
const SEQUENCE_MOD = 200 // 每毫秒序号容量 0-199

let lastTimestamp = -1
let sequence = 0

export const generateSnowflakeId = (): string => {
  let now = Date.now() - CUSTOM_EPOCH

  if (now === lastTimestamp) {
    sequence = (sequence + 1) % SEQUENCE_MOD
    if (sequence === 0) {
      // 本毫秒序号耗尽，自旋到下一毫秒
      while (now <= lastTimestamp) {
        now = Date.now() - CUSTOM_EPOCH
      }
    }
  } else {
    sequence = 0
  }

  // 时钟回拨时沿用上次时间戳，保证单调不重复
  if (now < lastTimestamp) {
    now = lastTimestamp
  }
  lastTimestamp = now

  return String(now * SEQUENCE_MOD + sequence)
}
