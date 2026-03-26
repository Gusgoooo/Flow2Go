import { HANDLE_ALIGN_UNIT } from './grid'

export type BuiltinAsset = {
  id: string
  name: string
  type: 'svg' | 'png'
  dataUrl: string
  width?: number
  height?: number
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// 默认内置素材尺寸：在当前基准上放大 2 倍
const DEFAULT_WIDTH = HANDLE_ALIGN_UNIT * 2
const DEFAULT_MIN_HEIGHT = HANDLE_ALIGN_UNIT * 2

function scaledHeight(sourceWidth: number, sourceHeight: number): number {
  return Math.max(DEFAULT_MIN_HEIGHT, Math.round((sourceHeight / sourceWidth) * DEFAULT_WIDTH))
}

const SHORT_ARROW_SVG =
  '<svg width="16" height="34" viewBox="0 0 16 34" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 9.5H11.5V33.5H4.5V9.5H0L8 0L16 9.5Z" fill="url(#paint0_linear_short)"/><defs><linearGradient id="paint0_linear_short" x1="12" y1="0" x2="12" y2="33.5" gradientUnits="userSpaceOnUse"><stop stop-color="#3A90FF"/><stop offset="1" stop-color="#3EA5FF" stop-opacity="0"/></linearGradient></defs></svg>'

const DOUBLE_ARROW_SVG =
  '<svg width="18" height="34" viewBox="0 0 18 34" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 9.5L8 0V33.5H4.5V9.5H0Z" fill="url(#paint0_linear_double)"/><path d="M17.5 24L9.5 33.5L9.5 0L13 0L13 24L17.5 24Z" fill="url(#paint1_linear_double)"/><defs><linearGradient id="paint0_linear_double" x1="4" y1="0" x2="4" y2="33.5" gradientUnits="userSpaceOnUse"><stop stop-color="#3A90FF"/><stop offset="1" stop-color="#3EA5FF" stop-opacity="0"/></linearGradient><linearGradient id="paint1_linear_double" x1="13.5" y1="33.5" x2="13.5" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#3A90FF"/><stop offset="1" stop-color="#3EA5FF" stop-opacity="0"/></linearGradient></defs></svg>'

const LONG_ARROW_SVG =
  '<svg width="16" height="60" viewBox="0 0 16 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 9.5H11.5V60H4.5V9.5H0L8 0L16 9.5Z" fill="url(#paint0_linear_long)"/><defs><linearGradient id="paint0_linear_long" x1="12" y1="0" x2="12" y2="60" gradientUnits="userSpaceOnUse"><stop stop-color="#3A90FF"/><stop offset="1" stop-color="#3EA5FF" stop-opacity="0"/></linearGradient></defs></svg>'

const ARC_ARROW_SVG =
  '<svg width="53" height="30" viewBox="0 0 53 30" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M35 9.5H30C31.3333 16 37.8 29.2 53 30H0C15.2 29.2 21.6667 16 23 9.5H18L26.5 0L35 9.5Z" fill="#55A0FE"/></svg>'

const PLUS_SVG =
  '<svg width="27" height="27" viewBox="0 0 27 27" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15.5 11.5H27V15.5H15.5V27H11.5V15.5H0V11.5H11.5V0H15.5V11.5Z" fill="#55A0FE"/></svg>'

const CROSS_SVG =
  '<svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M33.3828 2.13086L18.8223 16.6914L33.3828 31.252L31.252 33.3828L16.6914 18.8223L2.13086 33.3828L0 31.252L14.5605 16.6914L0 2.13086L2.13086 0L16.6914 14.5605L31.252 0L33.3828 2.13086Z" fill="#55A0FE"/></svg>'

export const BUILTIN_ASSETS: BuiltinAsset[] = [
  {
    id: 'builtin-arrow-short',
    name: '短箭头',
    type: 'svg',
    dataUrl: svgDataUrl(SHORT_ARROW_SVG),
    width: DEFAULT_WIDTH,
    height: scaledHeight(16, 34),
  },
  {
    id: 'builtin-arrow-double',
    name: '双向箭头',
    type: 'svg',
    dataUrl: svgDataUrl(DOUBLE_ARROW_SVG),
    width: DEFAULT_WIDTH,
    height: scaledHeight(18, 34),
  },
  {
    id: 'builtin-arrow-long',
    name: '长箭头',
    type: 'svg',
    dataUrl: svgDataUrl(LONG_ARROW_SVG),
    width: DEFAULT_WIDTH,
    height: scaledHeight(16, 60),
  },
  {
    id: 'builtin-arrow-arc',
    name: '弧线箭头',
    type: 'svg',
    dataUrl: svgDataUrl(ARC_ARROW_SVG),
    width: DEFAULT_WIDTH,
    height: scaledHeight(53, 30),
  },
  {
    id: 'builtin-symbol-plus',
    name: '加号',
    type: 'svg',
    dataUrl: svgDataUrl(PLUS_SVG),
    width: DEFAULT_WIDTH,
    height: scaledHeight(27, 27),
  },
  {
    id: 'builtin-symbol-cross',
    name: '交叉符号',
    type: 'svg',
    dataUrl: svgDataUrl(CROSS_SVG),
    width: DEFAULT_WIDTH,
    height: scaledHeight(34, 34),
  },
]
