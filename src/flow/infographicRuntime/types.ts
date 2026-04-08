import type { InfographicTextRole } from '../constants'

export type OcrBlock = {
  text: string
  bbox: [number, number, number, number]
  /** 识别出的字体大小（px，基于 1600x900 坐标系），可选 */
  fontSize?: number
  /** 识别出的字重（400/600/700 等），可选 */
  fontWeight?: number
  /** 识别出的文字颜色（#RRGGBB），可选 */
  color?: string
}

export type RoleBlock = OcrBlock & {
  role: InfographicTextRole
}

export type InfographicAnalysisJson = {
  summary: string
  analysis: string
  imagePrompt: string
}
