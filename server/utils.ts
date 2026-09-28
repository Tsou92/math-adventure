/**
 * 解析 prompt_data 字段：从 JSONB 或字符串转换为对象。
 * 数据库返回的 prompt_data 可能是已解析的对象、JSON 字符串或 null。
 */
export function promptData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return value as Record<string, unknown>;
}
