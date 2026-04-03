/**
 * Routify 代理的 AK 配置（对齐 codify 思路）：
 * - 客户端只带 `X-API-Token`，不暴露真实 API Key；
 * - 服务端用 Token 名称映射到 `process.env` 中的 AK / Base URL；
 * - 默认 Token：`flow2go_routify` → `ROUTIFY_API_KEY` + `ROUTIFY_BASE_URL`。
 *
 * 可选扩展：设置环境变量 `ROUTIFY_TOKEN_MAP_JSON`（JSON 字符串），
 * 值为 Record<tokenName, { apiKeyEnv: string; baseUrlEnv?: string }>，
 * 其中 apiKeyEnv / baseUrlEnv 为环境变量名（不是密钥本身）。
 */

export const DEFAULT_ROUTIFY_OPENAI_BASE = 'https://routify.alibaba-inc.com/protocol/openai/v1'

export type ResolvedRoutifyProfile = {
  token: string
  apiKey: string
  baseURL: string
  /** 日志用：来自哪个 env 键名 */
  source: string
}

export type ResolveError = { error: string; status: number }

function trimBase(url: string): string {
  return url.replace(/\/+$/, '')
}

function loadExtraTokenMap(): Record<
  string,
  { apiKeyEnv: string; baseUrlEnv?: string }
> {
  const raw = (process.env.ROUTIFY_TOKEN_MAP_JSON || '').trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, { apiKeyEnv: string; baseUrlEnv?: string }>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    console.warn('[routifyTokenMap] ROUTIFY_TOKEN_MAP_JSON 解析失败，已忽略')
    return {}
  }
}

/**
 * 从请求头解析 `X-API-Token`（与 codify 一致），得到上游 AK 与 base。
 * 未传 header 时等价于 `flow2go_routify`，保持旧行为。
 */
export function resolveRoutifyProfile(req: {
  headers: { [k: string]: string | string[] | undefined }
}): ResolvedRoutifyProfile | ResolveError {
  const raw = req.headers['x-api-token']
  const headerVal = Array.isArray(raw) ? raw[0] : raw
  const token = (typeof headerVal === 'string' && headerVal.trim()
    ? headerVal.trim()
    : 'flow2go_routify')

  const extra = loadExtraTokenMap()

  if (token === 'flow2go_routify') {
    const apiKey = (process.env.ROUTIFY_API_KEY || '').trim()
    if (!apiKey) {
      return {
        error: '服务端未配置 ROUTIFY_API_KEY（或 X-API-Token 对应的环境变量）',
        status: 500,
      }
    }
    const baseURL = trimBase(process.env.ROUTIFY_BASE_URL || DEFAULT_ROUTIFY_OPENAI_BASE)
    return {
      token,
      apiKey,
      baseURL,
      source: process.env.ROUTIFY_BASE_URL ? 'ROUTIFY_BASE_URL' : 'default',
    }
  }

  const spec = extra[token]
  if (!spec || typeof spec.apiKeyEnv !== 'string') {
    return {
      error: `无效的 X-API-Token: ${token}。请在 ROUTIFY_TOKEN_MAP_JSON 中声明，或使用 flow2go_routify`,
      status: 401,
    }
  }

  const apiKey = (process.env[spec.apiKeyEnv] || '').trim()
  if (!apiKey) {
    return {
      error: `Token「${token}」对应的环境变量 ${spec.apiKeyEnv} 未设置或为空`,
      status: 500,
    }
  }

  const baseEnv = spec.baseUrlEnv
  const baseURL = trimBase(
    (baseEnv && process.env[baseEnv]) || process.env.ROUTIFY_BASE_URL || DEFAULT_ROUTIFY_OPENAI_BASE,
  )
  return {
    token,
    apiKey,
    baseURL,
    source: `${spec.apiKeyEnv} + ${baseEnv ?? 'ROUTIFY_BASE_URL|default'}`,
  }
}
