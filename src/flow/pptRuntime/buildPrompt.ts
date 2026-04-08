import type { PptSlideInput } from './types'

function cleanLine(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

export function buildPptSlidePrompt(slide: PptSlideInput): string {
  const lines: string[] = []
  const title = cleanLine(slide.title)
  const subtitle = cleanLine(slide.subtitle)
  const body = Array.isArray(slide.body) ? slide.body.map(cleanLine).filter(Boolean) : []

  if (title) lines.push(`[title] ${title}`)
  if (subtitle) lines.push(`[subtitle] ${subtitle}`)
  for (const item of body) lines.push(`[body] ${item}`)

  const content = lines.join('\n')

  const constraints = [
    '你是 PPT 单页生成器（只生成一页）。',
    '请生成 16:9 PPT 页面效果图，所有页面风格一致，适合演示文稿。',
    '严格区分文字层级：title 最大，subtitle 次之，body 最小。',
    '每页最多 1 个 title，最多 1 个 subtitle，body 最多 5 行。',
    '页面需要有清晰视觉中心，版式简洁，不要出现多个并列标题。',
    '禁止混用层级（不要把 body 画成标题大小）。',
  ].join('\n')

  return [constraints, '', '【本页内容（严格按行渲染，不要自行增删层级）】', content].join('\n')
}

