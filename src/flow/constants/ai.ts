/** Routify 网关默认文本模型（OpenAI 兼容 model 字段） */
export const DEFAULT_ROUTIFY_TEXT_MODEL = 'gpt-5.4-2026-03-05'

/** Routify 网关默认视觉模型 */
export const DEFAULT_ROUTIFY_VISION_MODEL = 'gpt-5.4-2026-03-05'

/** OpenRouter key 掩码包装 */
export const OPENROUTER_MASK = '*****'

/** AI 生成默认超时（ms） */
export const DEFAULT_TIMEOUT_MS = 90_000

/** 长输入摘要阈值（字符数） */
export const LONG_INPUT_SUMMARY_THRESHOLD = 2200

/** 长输入超时（ms） */
export const LONG_INPUT_TIMEOUT_MS = 150_000

/** 流程图节点上限 */
export const FLOWCHART_GUARD_NODE_MAX = 16

/** 流程图边上限 */
export const FLOWCHART_GUARD_EDGE_MAX = 20

/** 流程图边超出节点数量的允差 */
export const FLOWCHART_GUARD_EDGE_OVER_NODE_ALLOWANCE = 4

/** 稳定生成时的温度参数 */
export const STABLE_GENERATION_TEMPERATURE = 0
