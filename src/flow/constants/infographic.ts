/** 信息图画布（与下游 OCR 坐标系一致） */
export const INFOGRAPH_CANVAS_WIDTH = 1600
export const INFOGRAPH_CANVAS_HEIGHT = 900

export const INFOGRAPH_FRAME_ROLE = 'infographic-frame'
export const INFOGRAPH_FRAME_GAP_X = 80
export const INFOGRAPH_FRAME_STEP_X = INFOGRAPH_CANVAS_WIDTH + INFOGRAPH_FRAME_GAP_X

/** 信息图内容在画框内的留白：0.5 个网格单位（GRID_UNIT=8 → 4px） */
export const INFOGRAPH_FRAME_PADDING_PX = 4
/** 画框标题与内容区（图片）之间的间距：0.5 个网格单位 */
export const INFOGRAPH_FRAME_TITLE_GAP_PX = 4
/** 画框标题栏占用高度（给内容区留出空间，避免标题压住图片） */
export const INFOGRAPH_FRAME_TITLE_BAR_PX = 26

export const INFOGRAPH_TEXT_COLOR = '#111111'
export const INFOGRAPH_FONT_FAMILY = 'Pingfang SC'

/** Vertex generateContent 默认生图模型 */
export const INFOGRAPH_IMAGE_GEN_MODEL = 'gemini-3.1-flash-image-preview'

/** 兼容旧 import（PPT 已废弃） */
export const PPT_SLIDE_WIDTH = INFOGRAPH_CANVAS_WIDTH
export const PPT_SLIDE_HEIGHT = INFOGRAPH_CANVAS_HEIGHT
export const PPT_FRAME_ROLE = INFOGRAPH_FRAME_ROLE
export const PPT_FRAME_GAP_X = INFOGRAPH_FRAME_GAP_X
export const PPT_FRAME_STEP_X = INFOGRAPH_FRAME_STEP_X
export const PPT_TEXT_COLOR = INFOGRAPH_TEXT_COLOR
export const PPT_FONT_FAMILY = INFOGRAPH_FONT_FAMILY
export const PPT_IMAGE_GENERATION_MODEL = INFOGRAPH_IMAGE_GEN_MODEL
export const PPT_EXPORT_SERVICE_BASE_URL = 'http://localhost:9007'

export type InfographicTextRole = 'title' | 'subtitle' | 'body' | 'caption'
/** @deprecated 使用 InfographicTextRole */
export type PptTextRole = InfographicTextRole

/** 占位：信息图以 OCR 框高动态推算字号；此处仅作兜底 */
export const INFOGRAPH_TYPOGRAPHY_FALLBACK: Record<
  InfographicTextRole,
  { fontSize: number; fontWeight: number; color: string; fontFamily: string }
> = {
  title: { fontSize: 48, fontWeight: 600, color: INFOGRAPH_TEXT_COLOR, fontFamily: INFOGRAPH_FONT_FAMILY },
  subtitle: { fontSize: 32, fontWeight: 600, color: INFOGRAPH_TEXT_COLOR, fontFamily: INFOGRAPH_FONT_FAMILY },
  body: { fontSize: 22, fontWeight: 400, color: INFOGRAPH_TEXT_COLOR, fontFamily: INFOGRAPH_FONT_FAMILY },
  caption: { fontSize: 16, fontWeight: 400, color: INFOGRAPH_TEXT_COLOR, fontFamily: INFOGRAPH_FONT_FAMILY },
}

export const PPT_TYPOGRAPHY_TOKENS = INFOGRAPH_TYPOGRAPHY_FALLBACK
