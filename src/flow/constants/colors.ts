/** 边默认颜色 */
export const DEFAULT_EDGE_COLOR = '#94a3b8'

/** 语义节点——完成状态 */
export const COMPLETED_STROKE = '#31C262'
export const COMPLETED_FILL = 'rgba(49, 194, 98, 0.12)'

/** 语义节点——失败状态 */
export const FAILED_STROKE = '#FF4E4E'
export const FAILED_FILL = 'rgba(255, 78, 78, 0.12)'

/** 语义节点——结束节点底色 */
export const END_NODE_FILL = 'rgba(226, 232, 240, 0.8)'

/** 语义节点——决策节点底色 */
export const DECISION_NODE_FILL = '#FFB100'
export const DECISION_LABEL_COLOR = '#ffffff'

/** 状态识别关键词 */
export const COMPLETED_KEYWORDS = ['完成', '通过']
export const FAILED_KEYWORDS = ['失败', '不通过']

/** 泳道标题文本颜色 */
export const DEFAULT_LANE_TITLE_TEXT_COLOR = '#334155'

/** 泳道表头背景色 */
export const DEFAULT_LANE_HEADER_BG = 'rgba(71, 85, 105, 0.08)'

/** 图生图泳道默认底色与描边 */
export const SWIMLANE_IMAGE_LANE_BODY_FILL = 'rgba(241, 245, 249, 0.5)'
export const SWIMLANE_IMAGE_LANE_STROKE = 'rgba(203, 213, 225, 0.6)'

/** 顶层 frame 主题配色轮换 */
export const TOP_FRAME_THEME_COLORS = ['#4d9ef5', '#33d8ea', '#c059ff', '#ff6cc4']

/** 预设颜色（统一色板） */
export const PRESET_COLORS = [
  '#FF6A00',
  '#C059FF',
  '#FF6CC4',
  '#4D9EF5',
  '#FFB100',
  '#33D8EA',
  '#FF4E4E',
  '#31C262',
  '#0f172a',
  '#64748b',
  '#94a3b8',
  '#e2e8f0',
  '#ffffff',
  '#fef3c7',
  '#86efac',
  '#7dd3fc',
] as const

/** AI 场景胶囊高亮用色：取预设色板前 5 个 */
export const AI_SCENE_CAPSULE_ACCENT_COLORS: readonly [string, string, string, string, string] = [
  PRESET_COLORS[0],
  PRESET_COLORS[1],
  PRESET_COLORS[2],
  PRESET_COLORS[3],
  PRESET_COLORS[4],
]

/** 最近使用数量 = 预设颜色数量 */
export const RECENT_COLORS_MAX = PRESET_COLORS.length
