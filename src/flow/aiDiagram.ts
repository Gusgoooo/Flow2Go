export type AiDiagramSchema = 'flow2go.ai.diagram.v1'

export type AiDiagramDraft = {
  schema: AiDiagramSchema
  title?: string
  nodes: unknown[]
  edges: unknown[]
  viewport?: { x: number; y: number; zoom: number }
  /** 原始响应文本（用于调试/展示） */
  rawText: string
}

export type OpenRouterChatOptions = {
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
  timeoutMs?: number
}

import { parseMermaidFlowchart, transpileMermaidFlowIR } from './mermaid'
import { materializeGraphBatchPayloadToSnapshot } from './mermaid/apply'

const DEFAULT_TIMEOUT_MS = 45_000

import FRONTEND_BACKEND_TMPL from '../../usertemplate/01_frontend_backend_flow_template.md?raw'
import DATA_PIPELINE_TMPL from '../../usertemplate/02_data_pipeline_flow_template.md?raw'
import AGENT_WORKFLOW_TMPL from '../../usertemplate/03_agent_workflow_template.md?raw'
import APPROVAL_WORKFLOW_TMPL from '../../usertemplate/04_approval_workflow_template.md?raw'
import SYSTEM_ARCH_TMPL from '../../usertemplate/05_system_architecture_template.md?raw'
import USER_JOURNEY_TMPL from '../../usertemplate/06_user_journey_template.md?raw'
import BUSINESS_BIG_MAP_TMPL from '../../usertemplate/07_business_big_map_template.md?raw'

export type UserTemplateKey =
  | 'Frontend-Backend Flow Template'
  | 'Data Pipeline Flow Template'
  | 'Agent Workflow Template'
  | 'Approval Workflow Template'
  | 'System Architecture Template'
  | 'User Journey Template'
  | 'Business Big Map Template'

const USER_TEMPLATES: Record<UserTemplateKey, string> = {
  'Frontend-Backend Flow Template': FRONTEND_BACKEND_TMPL,
  'Data Pipeline Flow Template': DATA_PIPELINE_TMPL,
  'Agent Workflow Template': AGENT_WORKFLOW_TMPL,
  'Approval Workflow Template': APPROVAL_WORKFLOW_TMPL,
  'System Architecture Template': SYSTEM_ARCH_TMPL,
  'User Journey Template': USER_JOURNEY_TMPL,
  'Business Big Map Template': BUSINESS_BIG_MAP_TMPL,
}

export const TEMPLATE_SELECTOR_SYSTEM_PROMPT = [
  '你是 Flow2Go 的模板选择器。',
  '',
  '你的任务不是直接生成图，而是先判断当前用户需求最适合使用哪一种模板，再按对应模板的结构要求去生成。',
  '',
  '可选模板只有以下 7 种：',
  '1. Frontend-Backend Flow Template',
  '2. Data Pipeline Flow Template',
  '3. Agent Workflow Template',
  '4. Approval Workflow Template',
  '5. System Architecture Template',
  '6. User Journey Template',
  '7. Business Big Map Template',
  '',
  '选择规则：',
  '- 涉及页面、接口、服务、数据库请求链路，优先 Frontend-Backend Flow',
  '- 涉及采集、清洗、加工、仓库、指标、消费，优先 Data Pipeline',
  '- 涉及 Planner、Executor、Reviewer、Tools、RAG、Memory，优先 Agent Workflow',
  '- 涉及申请、审核、驳回、会签、通知、归档，优先 Approval Workflow',
  '- 涉及平台模块、服务分层、基础设施、第三方依赖，优先 System Architecture',
  '- 涉及用户阶段、触点、行为、痛点、机会点，优先 User Journey',
  '- 涉及战略全景图、能力地图、知识结构图、系统分层大图、方案拆解图、业务总览图，优先 Business Big Map',
  '',
  '如果需求同时满足多个模板：',
  '- 优先选择最接近用户核心意图的模板',
  '- 其次选择最能体现结构分层的模板',
  '- 避免混用多个模板导致结构失焦',
  '',
  '输出要求（强制）：',
  '- 只能输出“模板名称”这一行（必须与上述 7 个模板名称完全一致）',
].join('\n')

export type FrameTypeKey = 'Type A' | 'Type B' | 'Type C' | 'Type D' | 'Type E' | 'Type F'
export type BusinessStyleKey = '样式1' | '样式2' | '样式3' | '样式4'

export const FRAME_SELECTOR_SYSTEM_PROMPT = [
  '你是 Flow2Go 的画框选择器。',
  '',
  '你的任务不是直接生成内容，而是先根据用户输入内容的结构复杂度与层级关系，判断应使用哪一种 frame 类型。',
  '',
  '可选 frame 类型：',
  '- Type A：横向概览条',
  '- Type B：双栏模块板',
  '- Type C：多列卡片组',
  '- Type D：左标题章节块',
  '- Type E：极简横向承载',
  '- Type F：双层嵌套复杂区',
  '',
  '判断标准：',
  '1. 平级概览 → A / E',
  '2. 左右两域 → B',
  '3. 多模块并列、每个模块下 2~3 个要点 → C',
  '4. 章节式信息块 → D',
  '5. 多层嵌套结构 → F',
  '',
  '输出要求（强制）：',
  '- 只能输出 “Type A / Type B / Type C / Type D / Type E / Type F” 其中之一，不要输出任何其他文字。',
].join('\n')

export async function openRouterSelectFrameType(args: OpenRouterChatOptions): Promise<FrameTypeKey> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const raw = await openRouterChatComplete({
    apiKey: key,
    model,
    system: FRAME_SELECTOR_SYSTEM_PROMPT,
    user: prompt.trim(),
    signal,
    timeoutMs,
    temperature: 0,
  })
  const normalized = raw.replace(/\s+/g, ' ').trim()
  const candidates: FrameTypeKey[] = ['Type A', 'Type B', 'Type C', 'Type D', 'Type E', 'Type F']
  const exact = candidates.find((c) => c === normalized)
  if (exact) return exact
  const fuzzy = candidates.find((c) => normalized.toLowerCase().includes(c.toLowerCase()))
  return fuzzy ?? 'Type F'
}

export const BUSINESS_STYLE_SELECTOR_PROMPT = [
  '你是 Flow2Go 的业务大图样式选择器。',
  '',
  '你的任务不是直接生成内容，而是先在以下 4 种参考样式中选择一个最合适的：',
  '- 样式1：单层横向摘要条（frame 内直接并列 quad）',
  '- 样式2：双栏模块板（frame 内 2 个大 group，每个 group 内 2xN 网格）',
  '- 样式3：多列小组（frame 内多个并列 group，每个 group 内 2 个纵向 quad）',
  '- 样式4：左标题章节块 + 多个子 group（中高密度、板块感强、适合业务总览）',
  '',
  '判断规则：',
  '1. 低密度概览：样式1',
  '2. 左右两域：样式2',
  '3. 多模块并列且每模块少量要点：样式3',
  '4. 章节式业务大图/能力地图/战略全景：样式4',
  '5. 若输入存在明显“左右对照”词（对比/双域/AB/左右），优先样式2；若存在“并列模块+少量要点”，优先样式3。',
  '',
  '输出要求（强制）：',
  '- 只能输出：样式1 或 样式2 或 样式3 或 样式4（仅一项）',
].join('\n')

export async function openRouterSelectBusinessStyle(args: OpenRouterChatOptions): Promise<BusinessStyleKey> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
  if (!prompt.trim()) throw new Error('请输入生成描述')
  const raw = await openRouterChatComplete({
    apiKey: key,
    model,
    system: BUSINESS_STYLE_SELECTOR_PROMPT,
    user: prompt.trim(),
    signal,
    timeoutMs,
    temperature: 0,
  })
  const normalized = raw.replace(/\s+/g, '').trim()
  const candidates: BusinessStyleKey[] = ['样式1', '样式2', '样式3', '样式4']
  const exact = candidates.find((c) => c === normalized)
  if (exact) return exact
  const mapped = normalized
    .replace('样式一', '样式1')
    .replace('样式二', '样式2')
    .replace('样式三', '样式3')
    .replace('样式四', '样式4')
    .replace('style1', '样式1')
    .replace('style2', '样式2')
    .replace('style3', '样式3')
    .replace('style4', '样式4')
  const exactMapped = candidates.find((c) => c === mapped)
  if (exactMapped) return exactMapped
  const fuzzy = candidates.find((c) => normalized.includes(c))
  if (fuzzy) return fuzzy
  const p = prompt
  if (/(对照|对比|双域|左右|A\/B|AB)/i.test(p)) return '样式2'
  if (/(模块|板块|能力|主题).*(要点|子项|条目)/i.test(p)) return '样式3'
  if (/(摘要|总览|概览|结论|索引)/i.test(p)) return '样式1'
  return '样式4'
}

function normalizeBusinessBigMapDraft(draft: AiDiagramDraft): AiDiagramDraft {
  const rawNodes = Array.isArray(draft.nodes) ? draft.nodes : []
  const frameById = new Map<string, any>()
  for (const n of rawNodes as any[]) {
    if (n && typeof n === 'object' && n.type === 'group' && n.data?.role === 'frame') frameById.set(n.id, n)
  }

  const parentOf = (id: string): string | null => {
    const n = frameById.get(id)
    if (!n?.parentId) return null
    return frameById.has(n.parentId) ? n.parentId : null
  }

  const childrenOf = (id: string) => {
    const out: string[] = []
    for (const [fid, n] of frameById.entries()) {
      if (n.parentId === id) out.push(fid)
    }
    return out
  }

  const topFrames: string[] = []
  for (const [fid, n] of frameById.entries()) {
    if (!n.parentId || !frameById.has(n.parentId)) topFrames.push(fid)
  }

  const depthFromRoot = (rootId: string, id: string) => {
    let d = 0
    let cur = id
    const seen = new Set<string>()
    while (cur !== rootId) {
      if (seen.has(cur)) break
      seen.add(cur)
      const p = parentOf(cur)
      if (!p) break
      d += 1
      cur = p
    }
    return cur === rootId ? d : -1
  }

  const ancestorAtDepth = (rootId: string, id: string, targetDepth: number): string | null => {
    let cur = id
    let d = depthFromRoot(rootId, id)
    if (d < 0) return null
    const seen = new Set<string>()
    while (d > targetDepth) {
      if (seen.has(cur)) break
      seen.add(cur)
      const p = parentOf(cur)
      if (!p) break
      cur = p
      d -= 1
    }
    return d === targetDepth ? cur : null
  }

  const collectLeafDepths = (rootId: string) => {
    const depths: number[] = []
    const stack = [rootId]
    const seen = new Set<string>()
    while (stack.length) {
      const cur = stack.pop() as string
      if (seen.has(cur)) continue
      seen.add(cur)
      const kids = childrenOf(cur)
      if (kids.length === 0) {
        const d = depthFromRoot(rootId, cur)
        if (d >= 1) depths.push(d)
        continue
      }
      for (const k of kids) stack.push(k)
    }
    return depths
  }

  // 同一父画框（顶层 frame）下只允许一种嵌套深度样式：
  // 选该子树最浅叶子深度作为目标层级，把更深层扁平到该层级。
  for (const rootId of topFrames) {
    const leafDepths = collectLeafDepths(rootId)
    if (!leafDepths.length) continue
    const targetLeafDepth = Math.max(1, Math.min(...leafDepths))
    for (const [fid, n] of frameById.entries()) {
      if (fid === rootId) continue
      const d = depthFromRoot(rootId, fid)
      if (d <= targetLeafDepth || d < 0) continue
      const anchor = ancestorAtDepth(rootId, fid, targetLeafDepth - 1)
      if (!anchor) continue
      n.parentId = anchor
    }
  }

  const nodes = rawNodes.map((n: any) => {
    if (!n || typeof n !== 'object') return n
    const data = { ...(n.data ?? {}) }
    if (typeof data.title === 'string') {
      data.title = data.title
        .replace(/\s*[｜|]\s*Type\s*[A-F]\s*$/i, '')
        .replace(/\s*[｜|]\s*T(?:ype)?\s*[A-F]?\s*$/i, '')
    }
    if (typeof data.label === 'string') {
      data.label = data.label
        .replace(/\s*[｜|]\s*Type\s*[A-F]\s*$/i, '')
        .replace(/\s*[｜|]\s*T(?:ype)?\s*[A-F]?\s*$/i, '')
    }
    return { ...n, data }
  })
  return {
    ...draft,
    nodes,
    edges: [],
  }
}

type NestingDepthKind = 'nest-1' | 'nest-2' | 'nest-3'

function analyzeBusinessNestingCoverage(draft: AiDiagramDraft) {
  const nodes = Array.isArray(draft.nodes) ? (draft.nodes as any[]) : []
  const frameById = new Map<string, any>()
  for (const n of nodes) {
    if (n && typeof n === 'object' && n.type === 'group' && n.data?.role === 'frame') frameById.set(n.id, n)
  }
  const childCount = new Map<string, number>()
  for (const n of frameById.values()) {
    if (!n.parentId || !frameById.has(n.parentId)) continue
    childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1)
  }
  const topFrames = [...frameById.values()].filter((f) => !f.parentId || !frameById.has(f.parentId))
  const kinds = new Set<NestingDepthKind>()
  for (const top of topFrames) {
    const hasChild = (childCount.get(top.id) ?? 0) > 0
    if (!hasChild) {
      kinds.add('nest-1')
      continue
    }
    // If any grand-child frame exists under this chapter, treat as 3-level.
    let hasGrand = false
    for (const f of frameById.values()) {
      const p = f.parentId
      if (!p || !frameById.has(p)) continue
      const pp = frameById.get(p)?.parentId
      if (pp === top.id) {
        hasGrand = true
        break
      }
    }
    kinds.add(hasGrand ? 'nest-3' : 'nest-2')
  }
  return {
    kinds,
    count: kinds.size,
    onlyKind: kinds.size === 1 ? [...kinds][0] : null,
  }
}

async function openRouterChatComplete(args: {
  apiKey: string
  model: string
  system: string
  user: string
  signal?: AbortSignal
  timeoutMs: number
  temperature: number
}): Promise<string> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), args.timeoutMs)
  const mergedSignal = args.signal
    ? (AbortSignal as any).any
      ? (AbortSignal as any).any([args.signal, controller.signal])
      : controller.signal
    : controller.signal

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Flow2Go',
      },
      signal: mergedSignal,
      body: JSON.stringify({
        model: args.model,
        temperature: args.temperature,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
      }),
    })

    const text = await res.text()
    if (!res.ok) throw new Error(`OpenRouter 错误 ${res.status}: ${text}`)
    const payload = JSON.parse(text)
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回内容')
    return content.trim()
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function openRouterSelectUserTemplate(args: OpenRouterChatOptions): Promise<UserTemplateKey> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = args
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const raw = await openRouterChatComplete({
    apiKey: key,
    model,
    system: TEMPLATE_SELECTOR_SYSTEM_PROMPT,
    user: prompt.trim(),
    signal,
    timeoutMs,
    temperature: 0,
  })

  const normalized = raw.replace(/\s+/g, ' ').trim()
  const candidates = Object.keys(USER_TEMPLATES) as UserTemplateKey[]
  const exact = candidates.find((c) => c === normalized)
  if (exact) return exact
  const fuzzy = candidates.find((c) => normalized.toLowerCase().includes(c.toLowerCase()))
  return fuzzy ?? 'Frontend-Backend Flow Template'
}

function stripCodeFences(s: string): string {
  const t = s.trim()
  // ``` ... ```
  const fence = t.match(/^```(?:mermaid|json)?\s*([\s\S]*?)\s*```$/i)
  if (fence?.[1]) return fence[1].trim()
  return t
}

function isFiniteNumber(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function validateAiDiagramDraft(obj: any, rawText: string): AiDiagramDraft {
  if (!obj || typeof obj !== 'object') throw new Error('AI 返回内容不是对象')
  if (obj.schema !== 'flow2go.ai.diagram.v1') throw new Error('AI schema 不匹配（需要 flow2go.ai.diagram.v1）')
  if (!Array.isArray(obj.nodes)) throw new Error('AI nodes 必须是数组')
  if (!Array.isArray(obj.edges)) throw new Error('AI edges 必须是数组')

  if (obj.viewport != null) {
    const v = obj.viewport
    if (!v || typeof v !== 'object') throw new Error('AI viewport 格式错误')
    if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y) || !isFiniteNumber(v.zoom)) throw new Error('AI viewport 坐标/缩放必须为数字')
  }

  return {
    schema: 'flow2go.ai.diagram.v1',
    title: typeof obj.title === 'string' ? obj.title : undefined,
    nodes: obj.nodes,
    edges: obj.edges,
    viewport: obj.viewport,
    rawText,
  }
}

export function normalizeAiDiagramToSnapshot(draft: AiDiagramDraft): { nodes: any[]; edges: any[]; viewport?: { x: number; y: number; zoom: number } } {
  // 第一阶段：最小归一化，保证结构可用；坐标/parentId 的强语义在应用阶段继续校验/修复。
  const nodes = Array.isArray(draft.nodes) ? draft.nodes : []
  const edges = Array.isArray(draft.edges) ? draft.edges : []
  const viewport = draft.viewport
  return { nodes, edges, viewport }
}

export function convertMermaidToAiDraft(rawText: string, opts?: { layoutProfile?: string }): AiDiagramDraft {
  const cleaned = stripCodeFences(rawText)
  const parsed = parseMermaidFlowchart(cleaned)
  if (!parsed.success || !parsed.ir) {
    const msg = parsed.errors?.[0]?.message || 'Mermaid 解析失败'
    throw new Error(msg)
  }
  const transpiled = transpileMermaidFlowIR(parsed.ir, cleaned, parsed.warnings)
  if (!transpiled.success || !transpiled.data) {
    const msg = transpiled.errors?.[0]?.message || 'Mermaid 转译失败'
    throw new Error(msg)
  }
  if (opts?.layoutProfile) {
    transpiled.data.meta = {
      ...(transpiled.data.meta ?? {}),
      layoutProfile: opts.layoutProfile,
    }
  }
  const snap = materializeGraphBatchPayloadToSnapshot(transpiled.data, { replace: true })
  return {
    schema: 'flow2go.ai.diagram.v1',
    title: undefined,
    nodes: snap.nodes,
    edges: snap.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    rawText: cleaned,
  }
}

export const DEFAULT_MERMAID_SYSTEM_PROMPT = [
  '你是 Flow2Go 的图表生成器。',
  '',
  '你的唯一任务是：根据用户输入，生成一段可被 Flow2Go 稳定解析的 Mermaid flowchart 代码。',
  '',
  '输出要求：',
  '- 只能输出 Mermaid 代码',
  '- 第一行必须严格为：flowchart LR',
  '- 不要输出任何解释、注释、前后缀、代码块围栏或其他文字',
  '',
  '语法限制（强制）：',
  '- 只允许使用：',
  '  - flowchart LR',
  '  - subgraph ... end',
  '  - id[中文标签]',
  '  - a --> b',
  '  - a -->|中文动作| b',
  '- 禁止使用：',
  '  - graph',
  '  - flowchart TB / RL / BT',
  '  - 圆形、菱形等其他节点写法，如 ()、{}、(())',
  '  - classDef、style、linkStyle、click、:::、注释、HTML、Markdown、任何高级 Mermaid 语法',
  '',
  '结构与画框（强制）：',
  '- 画框（subgraph）不是必选：AI 应根据用户诉求决定是否需要画框、需要几个画框、以及是否需要嵌套画框',
  '- 当用户诉求是“树状/层级/编组/目录结构”时：优先使用嵌套 subgraph 表达层级（一级标题/二级分组/三级条目…）',
  '- 当用户诉求是“流程/调用链/有大量连线”时：可以减少画框层级，优先保证连线清晰',
  '',
  '节点要求（强制）：',
  '- 所有节点都必须显式写成：id[中文标签]',
  '- 禁止只写裸 id',
  '- 所有节点 id 只能包含：小写英文字母、数字、下划线',
  '- 不要重复定义同一个 id',
  '- 不要为同一个 id 生成不同中文标签',
  '- 不要生成无意义 id，例如 node_1、tmp_a、test_x、_____fe_payment___',
  '',
  '标签要求（强制）：',
  '- 所有节点 label 必须是中文',
  '- 所有边 label 必须是中文',
  '- 节点 label 要简短、自然、语义明确，建议 2-8 个汉字',
  '- 边 label 要表示动作，建议 2-6 个汉字',
  '- 禁止英文 label、乱码、占位符、下划线噪音文本、超长句子',
  '',
  '副标题编码（V2，强制遵守）：',
  '- 若节点语义超过 5 个字，请在同一个方括号里拆成主/副标题：',
  '  - 推荐：id[主标题｜副标题]',
  '  - 兼容：id[主标题\\n副标题]',
  '- 主标题尽量 <=5 个字；副标题用于补充说明（可稍长）',
  '',
  '边要求（强制）：',
  '- 所有边必须使用 --> 或 -->|中文动作|',
  '- 推荐优先使用带中文动作的边',
  '- 边必须连接已定义节点',
  '- 不要为了“连通”硬连：允许编组内存在无边节点，用 subgraph 表达归属',
  '- 允许跨 Frontend 和 Backend 连线',
  '- 边动作应简洁明确，例如：提交、校验、调用服务、创建订单、支付回调、更新状态、返回结果',
  '',
  '规模与可读性（强制）：',
  '- 以“最小 Mermaid DSL”完成用户诉求：能少就少，能省就省',
  '- 默认建议：6~9 个节点（再多会失控）；边尽量少（建议 <= 节点数 - 2）',
  '- 只保留主干结构：避免把每个细节都拆成节点；避免把每个关系都画边',
  '- 信息很多时：用 subgraph（分组/画框）承载，而不是用大量边把所有节点串起来',
  '- 能用“编组/分区”表达归属关系时，不画边',
  '',
  '默认生成策略：',
  '- 如果用户描述不完整，自动补全为合理的前后端业务流程图',
  '- 优先体现：前端发起 -> 后端处理 -> 状态返回/结果展示',
  '',
  '输出前自检（强制）：',
  '- 是否第一行严格为 flowchart LR',
  '- 是否所有节点都使用 id[中文标签]',
  '- 是否所有 id 都合法（小写英文字母/数字/下划线）',
  '- 是否所有 label 都是中文',
  '- 是否节点与边数量合理（优先少边少节点）',
  '- 是否没有孤立节点',
  '- 是否没有使用任何被禁止的 Mermaid 语法',
  '',
  '如果有任何一项不满足，先在内部修正，再输出最终 Mermaid。',
].join('\n')

export const DEFAULT_MERMAID_USER_TEMPLATE = ['{{prompt}}'].join('\n')

export async function openRouterGenerateDiagram(opts: OpenRouterChatOptions): Promise<AiDiagramDraft> {
  const { apiKey, model, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  const key = (apiKey ?? '').trim()
  if (!key) throw new Error('缺少 OpenRouter API Key')
  if (!prompt.trim()) throw new Error('请输入生成描述')

  const chosen = await openRouterSelectUserTemplate({ apiKey: key, model, prompt, signal, timeoutMs })
  const templateText = USER_TEMPLATES[chosen] || ''
  const frameType = chosen === 'Business Big Map Template' ? await openRouterSelectFrameType({ apiKey: key, model, prompt, signal, timeoutMs }) : null
  const businessStyle =
    chosen === 'Business Big Map Template' ? await openRouterSelectBusinessStyle({ apiKey: key, model, prompt, signal, timeoutMs }) : null

  const templateSubgraphRules: Record<UserTemplateKey, string> = {
    'Frontend-Backend Flow Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达分层分区；至少 4 个一级 subgraph：',
      '  - Frontend',
      '  - Gateway / BFF / API Layer',
      '  - Backend Services',
      '  - Database / Cache / External',
      '- 若后端服务有多个子域（订单/支付/用户等），允许在 Backend Services 下嵌套 subgraph 分组（V2）。',
    ].join('\n'),
    'Data Pipeline Flow Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达数据管道分区；至少 5 个一级 subgraph：',
      '  - Data Sources',
      '  - Ingestion',
      '  - Processing / Transformation',
      '  - Storage / Warehouse / Feature Store',
      '  - Serving / BI / API / Consumers',
      '- 治理/监控链路可单独做一个 subgraph：Observability / Data Quality（推荐）。',
    ].join('\n'),
    'Agent Workflow Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达模块边界，至少包含：',
      '  - User / Trigger',
      '  - Planner / Orchestrator',
      '  - Specialist Agents（可嵌套多个子 subgraph）',
      '  - Tools / Knowledge / Memory',
      '  - Reviewer / Verifier',
      '  - Output',
    ].join('\n'),
    'Approval Workflow Template': [
      '【模板落地要求（强制）】',
      '- 必须按角色或阶段用 subgraph 分组（至少 4 个）：',
      '  - Applicant',
      '  - Approvers（至少两级，可嵌套 subgraph）',
      '  - System / Notification',
      '  - Archive / Record',
    ].join('\n'),
    'System Architecture Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达系统分层（至少 6 个）：',
      '  - Users / Entry Points',
      '  - Access Layer',
      '  - Core Business Services（允许嵌套多个子 subgraph）',
      '  - Platform Capabilities',
      '  - Data Layer',
      '  - Infrastructure / External',
    ].join('\n'),
    'User Journey Template': [
      '【模板落地要求（强制）】',
      '- 必须用 subgraph 表达“阶段”；至少 4 个一级 subgraph（阶段名可中文/英文混合）：',
      '  - Awareness',
      '  - Onboarding / Consideration',
      '  - Usage / Interaction',
      '  - Retention / Completion',
      '- 每个阶段内部建议用嵌套 subgraph 或节点簇表达：目标/行为/触点/系统响应/痛点/机会点（V2）。',
    ].join('\n'),
    'Business Big Map Template': [
      '【模板落地要求（强制）】',
      '- 必须生成多个一级 subgraph 作为“章节 frame”，从上到下组织（章节之间保持统一节奏）。',
      '- 一级章节数量不得超过 5 个（硬限制）。',
      '- 必须使用嵌套 subgraph 表达层级：章节(frame) → 模块(group) → 子模块(subgroup) → 要点(quad)。',
      '- 至少包含 3 个二级 subgraph（模块级 group），确保可见编组结构。',
      '- 任意父画框下，直接子画框数量不得超过 3（硬限制）。',
      `- 参考样式：${businessStyle ?? '样式4'}（来自用户提供 project.json 的样式1~4，优先按该样式的容器结构组织）。`,
      `- 已选择的主画框类型：${frameType ?? 'Type F'}（仅用于内部排版策略参考，不要写入任何标题或节点文本）。`,
      '- 不要在标题后附加任何类型后缀文本（例如：`｜Type`、`｜T`、`|T`）。',
      '- 业务大图禁止任何连线：不要输出任何 `-->` 或带标签连线。',
      '- 排版要紧凑：同层分组与节点保持统一小间距，优先规则栅格。',
      '- 控制复杂度：一级章节建议 3~5 个；每章二级模块建议 2~3 个；每个模块下要点建议 2 或 4 个（尽量偶数）。',
      '- 同一章节内的二级模块尽量保持“要点数量一致”（例如都 2 个或都 4 个），避免参差。',
      '- 画框横向平铺；节点必须使用竖向倒N（先上下，再换列），节点列数最多 2 列。',
      '- 结构多样化（硬约束）：整张业务大图必须同时出现三类章节结构：',
      '  - 章节A（Case 1）：1层嵌套（章节画框直接包含节点，不允许任何子 subgraph）',
      '  - 章节B（Case 2）：2层嵌套（章节 -> 二级画框 -> 节点；禁止出现子画框）',
      '  - 章节C（Case 3）：3层嵌套（章节 -> 二级画框 -> 子画框 -> 节点）',
      '- 每一个章节画框必须只属于上述三类之一：禁止同一章节内混用不同层数。',
      '- 1层嵌套章节：直接放 4~6 个 quad 节点即可（最简）。',
      '- 2层嵌套章节：2~3 个二级画框，每个二级画框 2~4 个节点（最简）。',
      '- 3层嵌套章节：2~3 个二级画框，每个二级画框 2~3 个子画框，每个子画框 2~4 个节点（最简）。',
      '- 嵌套样式从外向内决定：最内层（直接承载节点）统一为“主题色 6% 底 + 主题色不透明描边”的样式，不要出现截断式标题。',
      '- 所有画框标题必须自然、完整、可读，不要截断，不要附加类型尾缀。',
      '- 文案尽量不超过 5 个字；超过 5 个字必须拆成主副标题（V2）。',
    ].join('\n'),
  }

  const baseMermaidSystem =
    chosen === 'Business Big Map Template'
      ? DEFAULT_MERMAID_SYSTEM_PROMPT.replace('第一行必须严格为：flowchart LR', '第一行必须严格为：flowchart TB').replace(
          '  - flowchart LR',
          '  - flowchart TB',
        )
      : DEFAULT_MERMAID_SYSTEM_PROMPT

  const system = [
    baseMermaidSystem,
    '',
    '【模板强约束】',
    `模板名称：${chosen}`,
    templateText.trim(),
    '',
    templateSubgraphRules[chosen],
    '',
    '【边数量控制（强制）】',
    ...(chosen === 'Business Big Map Template'
      ? ['- 业务大图必须为 0 条边（edges = 0）']
      : [
          '- 如果关系很多：优先用“汇总节点/分组”替代全连接，避免每对节点都连边',
          '- 一般情况下，边数量尽量控制在：edges <= nodes + 3',
          '- 避免同一对节点重复多条边；避免交叉边过多',
        ]),
  ].join('\n')

  const user = DEFAULT_MERMAID_USER_TEMPLATE.replaceAll('{{prompt}}', prompt.trim())
  const generateOnce = async (extraUserHint?: string) => {
    const content = await openRouterChatComplete({
      apiKey: key,
      model,
      system,
      user: extraUserHint ? `${user}\n\n${extraUserHint}` : user,
      signal,
      timeoutMs,
      temperature: 0.2,
    })
    return convertMermaidToAiDraft(content, {
      layoutProfile: chosen === 'Business Big Map Template' ? 'business-big-map' : undefined,
    })
  }

  if (chosen !== 'Business Big Map Template') {
    return generateOnce()
  }

  // 结构配额器：
  // - 连续两次都只产出同一嵌套深度 -> 自动重试一次
  // - 目标是最小覆盖 3 种样式（3层/2层/1层）
  const attempts: AiDiagramDraft[] = []
  const analyses: ReturnType<typeof analyzeBusinessNestingCoverage>[] = []
  const hints = [
    '',
    '【结构配额器重试】请强制混合 3 种嵌套样式并显式覆盖：3层嵌套、2层嵌套、1层嵌套；不要只输出单一深度。',
    '【结构配额器最终重试】前两次仍不达标。请优先保证 3 种嵌套样式最小覆盖，再优化美观与密度。',
  ]
  for (let i = 0; i < 2; i += 1) {
    const d = await generateOnce(hints[i] || undefined)
    attempts.push(d)
    analyses.push(analyzeBusinessNestingCoverage(d))
    if (analyses[i].count >= 3) return normalizeBusinessBigMapDraft(d)
  }
  const sameSingleDepthTwice = analyses[0].count === 1 && analyses[1].count === 1 && analyses[0].onlyKind === analyses[1].onlyKind
  if (sameSingleDepthTwice || analyses[1].count < 3) {
    const d3 = await generateOnce(hints[2])
    attempts.push(d3)
    analyses.push(analyzeBusinessNestingCoverage(d3))
    if (analyses[2].count >= 3) return normalizeBusinessBigMapDraft(d3)
  }
  // 兜底：选覆盖度最高的一次结果
  let bestIndex = 0
  for (let i = 1; i < analyses.length; i += 1) {
    if (analyses[i].count > analyses[bestIndex].count) bestIndex = i
  }
  return normalizeBusinessBigMapDraft(attempts[bestIndex])
}

