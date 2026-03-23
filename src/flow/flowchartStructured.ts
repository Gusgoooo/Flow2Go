import type { GraphBatchPayload } from './mermaid/types'

type GenerateFlowchartBatchOptions = {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
  timeoutMs?: number
}

const FLOWCHART_BATCH_SYSTEM_PROMPT = [
  '你是 Flow2Go 的 Flowchart JSON Planner。',
  '请把用户需求结构化为可直接渲染的 GraphBatchPayload JSON。',
  '',
  '要求：',
  '1) 只能输出严格 JSON，不要 markdown 或说明文字。',
  '2) 输出 schema：GraphBatchPayload（version/source/graphType/direction/operations/meta）。',
  '3) graphType 固定为 "flowchart"，direction 优先 "LR"。',
  '4) operations 仅可使用：graph.createFrame / graph.createNodeQuad / graph.createEdge / graph.autoLayout。',
  '5) 节点 title 要简洁（4-14字），禁止“步骤1/节点A/操作1”等占位命名。',
  '6) 保证 source/target 都引用存在节点；最后必须追加 graph.autoLayout(scope=all)。',
  '7) 推荐将角色或阶段组织成少量 frame，但避免过度嵌套。',
  '',
  '输出示例（仅示意字段，不要照抄内容）：',
  '{',
  '  "version":"1.0",',
  '  "source":"mermaid",',
  '  "graphType":"flowchart",',
  '  "direction":"LR",',
  '  "operations":[',
  '    {"op":"graph.createNodeQuad","params":{"id":"n1","title":"提交申请"}},',
  '    {"op":"graph.createNodeQuad","params":{"id":"n2","title":"系统校验"}},',
  '    {"op":"graph.createEdge","params":{"id":"e1","source":"n1","target":"n2"}},',
  '    {"op":"graph.autoLayout","params":{"direction":"LR","scope":"all"}}',
  '  ],',
  '  "meta":{"layoutProfile":"flow"}',
  '}',
].join('\n')

function safeJsonParse(raw: string): any {
  const t = raw.trim()
  try {
    return JSON.parse(t)
  } catch {
    const s = t.indexOf('{')
    const e = t.lastIndexOf('}')
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1))
    throw new Error('LLM 返回内容不是合法 JSON')
  }
}

function validateFlowchartBatch(payload: any): GraphBatchPayload {
  if (!payload || typeof payload !== 'object') throw new Error('Flowchart JSON 为空')
  const ops = Array.isArray(payload.operations) ? payload.operations : []
  if (!ops.length) throw new Error('Flowchart JSON 缺少 operations')

  const nodeIds = new Set<string>()
  const cleanOps: any[] = []
  for (const op of ops) {
    if (!op || typeof op !== 'object' || typeof op.op !== 'string') continue
    if (op.op === 'graph.createNodeQuad') {
      const id = String(op?.params?.id ?? '').trim()
      const title = String(op?.params?.title ?? '').trim()
      if (!id || !title) continue
      if (/^(步骤|节点|操作)\d+$/i.test(title)) continue
      nodeIds.add(id)
      cleanOps.push({
        op: 'graph.createNodeQuad',
        params: {
          id,
          title: title.slice(0, 16),
          subtitle: typeof op?.params?.subtitle === 'string' ? op.params.subtitle.slice(0, 24) : undefined,
          shape: op?.params?.shape,
          parentId: op?.params?.parentId,
          style: op?.params?.style,
        },
      })
      continue
    }
    if (op.op === 'graph.createFrame') {
      const id = String(op?.params?.id ?? '').trim()
      const title = String(op?.params?.title ?? '').trim()
      if (!id || !title) continue
      cleanOps.push({
        op: 'graph.createFrame',
        params: {
          id,
          title: title.slice(0, 16),
          parentId: op?.params?.parentId,
          style: op?.params?.style,
        },
      })
      continue
    }
    if (op.op === 'graph.createEdge') {
      const id = String(op?.params?.id ?? '').trim()
      const source = String(op?.params?.source ?? '').trim()
      const target = String(op?.params?.target ?? '').trim()
      if (!id || !source || !target) continue
      if (!nodeIds.has(source) || !nodeIds.has(target)) continue
      cleanOps.push({
        op: 'graph.createEdge',
        params: {
          id,
          source,
          target,
          type: op?.params?.type,
          label: typeof op?.params?.label === 'string' ? op.params.label.slice(0, 12) : undefined,
          arrowStyle: op?.params?.arrowStyle,
          style: op?.params?.style,
        },
      })
      continue
    }
  }

  cleanOps.push({
    op: 'graph.autoLayout',
    params: { direction: 'LR', scope: 'all' },
  })

  return {
    version: '1.0',
    source: 'mermaid',
    graphType: 'flowchart',
    direction: 'LR',
    operations: cleanOps,
    meta: { layoutProfile: 'flow' },
  }
}

export async function generateFlowchartBatchWithLLM(
  opts: GenerateFlowchartBatchOptions,
): Promise<GraphBatchPayload> {
  const { apiKey, model, prompt, signal, timeoutMs = 45_000 } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: FLOWCHART_BATCH_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`OpenRouter 请求失败: ${res.status}`)
    const outer = JSON.parse(text)
    const content = String(outer?.choices?.[0]?.message?.content ?? '').trim()
    const raw = safeJsonParse(content)
    return validateFlowchartBatch(raw)
  } catch (e) {
    if (controller.signal.aborted) throw new Error('流程图JSON生成超时或已取消')
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

