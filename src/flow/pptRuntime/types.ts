import type { PptTextRole } from '../constants'

export type PptSlideInput = {
  title?: string
  subtitle?: string
  body?: string[]
}

export type StyleImageInput = { name?: string; dataUrl: string }

export type OcrBlock = {
  text: string
  bbox: [number, number, number, number] // x,y,w,h in 1440x800 coordinate space
}

export type RoleBlock = OcrBlock & {
  role: PptTextRole
}

export type ExportTextNode = {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontWeight: number
  color: string
  fontFamily: string
  role: PptTextRole
}

export type ExportSlide = {
  slideIndex: number
  width: number
  height: number
  backgroundImage: { url: string; x: number; y: number; width: number; height: number }
  textNodes: ExportTextNode[]
}

export type ExportPayload = {
  slides: ExportSlide[]
}

