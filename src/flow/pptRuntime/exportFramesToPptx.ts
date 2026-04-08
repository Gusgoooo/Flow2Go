import type { Node } from '@xyflow/react'
import { buildPptExportPayload } from './buildExportPayload'

export async function exportFramesToPptx(args: {
  nodes: Node[]
  exportServiceBaseUrl: string
}): Promise<void> {
  const { nodes, exportServiceBaseUrl } = args
  const payload = buildPptExportPayload(nodes)
  if (!payload.slides || payload.slides.length === 0) {
    throw new Error('没有可导出的PPT页面')
  }

  const base = exportServiceBaseUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/ppt/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`PPT 导出失败：${res.status} ${msg}`.trim())
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'flow2go.pptx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

