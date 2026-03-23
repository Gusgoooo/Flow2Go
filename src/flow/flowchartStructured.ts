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
  '8) 先做“简化过滤”：优先主链，合并重复/近义步骤，删除冗余分支；控制节点与边数量，降低交叉风险。',
  '9) 预判交叉风险：避免大量跨层回跳和互相对向连线，优先 C/S 友好的邻近连接。',
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

const FLOWCHART_SIMPLIFY_SYSTEM_PROMPT = [
  '你是流程简化过滤器。',
  '请把用户需求压缩为“低交叉风险”的流程要点清单：',
  '- 保留主链与关键异常分支',
  '- 合并重复或同义步骤',
  '- 删除装饰性细节',
  '- 节点标题要短（4-12字）',
  '- 控制规模：建议 8-18 个步骤，12-24 条边',
  '只输出中文要点列表，每行一个步骤，不要其它解释。',
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
  const frames: any[] = []
  const nodes: any[] = []
  const edges: any[] = []
  for (const op of ops) {
    if (!op || typeof op !== 'object' || typeof op.op !== 'string') continue
    if (op.op === 'graph.createNodeQuad') {
      const id = String(op?.params?.id ?? '').trim()
      const title = String(op?.params?.title ?? '').trim()
      if (!id || !title) continue
      if (/^(步骤|节点|操作)\d+$/i.test(title)) continue
      nodeIds.add(id)
      frames.push({
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
      nodes.push({
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
      edges.push({
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

  // 简化过滤层（后处理）：节点/边数量与高扇出约束
  const MAX_NODES = 18
  const MAX_EDGES = 24
  const keptNodes = nodes.slice(0, MAX_NODES)
  const keptNodeIds = new Set(keptNodes.map((n) => String(n.params.id)))
  const outCnt = new Map<string, number>()
  const dedup = new Set<string>()
  const keptEdges: any[] = []
  for (const e of edges) {
    const s = String(e.params.source)
    const t = String(e.params.target)
    if (!keptNodeIds.has(s) || !keptNodeIds.has(t)) continue
    const k = `${s}->${t}`
    if (dedup.has(k)) continue
    dedup.add(k)
    const n = outCnt.get(s) ?? 0
    if (n >= 2) continue
    outCnt.set(s, n + 1)
    keptEdges.push(e)
    if (keptEdges.length >= MAX_EDGES) break
  }
  cleanOps.push(...frames, ...keptNodes, ...keptEdges)

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
    // LLM 简化过滤层：先压缩成低交叉风险流程要点
    const simplifyRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: FLOWCHART_SIMPLIFY_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })
    const simplifyText = await simplifyRes.text()
    if (!simplifyRes.ok) throw new Error(`OpenRouter 简化过滤失败: ${simplifyRes.status}`)
    const simplifyOuter = JSON.parse(simplifyText)
    const simplifiedPrompt = String(simplifyOuter?.choices?.[0]?.message?.content ?? '').trim() || prompt

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
          { role: 'user', content: simplifiedPrompt },
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

