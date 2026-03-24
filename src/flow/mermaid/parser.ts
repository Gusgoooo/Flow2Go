import type {
  FlowDirection,
  GraphError,
  GraphWarning,
  MermaidFlowIR,
  MermaidIREdge,
  MermaidIRNode,
  MermaidIRSubgraph,
  MermaidNodeShape,
  ParseMermaidResult,
} from './types'

type ParserState = {
  direction: FlowDirection
  subgraphs: MermaidIRSubgraph[]
  nodes: MermaidIRNode[]
  edges: MermaidIREdge[]
  warnings: GraphWarning[]
  errors: GraphError[]
}

function normalizeMermaid(input: string): string {
  // also accept escaped "\\n" from some model outputs,
  // but do NOT expand "\\n" inside node labels like id[主标题\\n副标题]
  const s = input.replace(/\r\n/g, '\n')
  let out = ''
  let inSquare = 0
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (ch === '[') inSquare += 1
    if (ch === ']' && inSquare > 0) inSquare -= 1
    if (!inSquare && ch === '\\' && s[i + 1] === 'n') {
      out += '\n'
      i += 1
      continue
    }
    out += ch
  }
  return out
}

function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parseDirectionDecl(line: string): FlowDirection | null {
  // support: flowchart LR/TB/RL/BT  (v1 only)
  // allow extra spaces
  const m = line.match(/^(flowchart|graph)\s+(LR|TB|RL|BT)\s*$/i)
  return (m?.[2]?.toUpperCase() as FlowDirection) ?? null
}

function splitLabelAndSubtitle(labelRaw: string): { label: string; subtitle?: string } {
  const t = labelRaw.trim()
  if (!t) return { label: t }
  const clampSubtitle = (s: string) => s.trim().slice(0, 10)
  // Allow encoding subtitle inside node label for v2:
  // - "主标题\n副标题"
  // - "主标题\\n副标题" (escaped newline inside [])
  // - "主标题|副标题" or "主标题｜副标题"
  const normalized = t.replace(/\r\n/g, '\n')
  const escapedIdx = normalized.indexOf('\\n')
  if (escapedIdx >= 0) {
    const head = normalized.slice(0, escapedIdx).trim()
    const tail = normalized.slice(escapedIdx + 2).trim()
    return tail ? { label: head || t, subtitle: clampSubtitle(tail) } : { label: head || t }
  }
  const firstNewline = normalized.indexOf('\n')
  if (firstNewline >= 0) {
    const head = normalized.slice(0, firstNewline).trim()
    const tail = normalized.slice(firstNewline + 1).trim()
    return tail ? { label: head || t, subtitle: clampSubtitle(tail) } : { label: head || t }
  }
  const pipeMatch = normalized.split(/[|｜]/g).map((s) => s.trim()).filter(Boolean)
  if (pipeMatch.length >= 2) {
    const [head, ...rest] = pipeMatch
    const tail = rest.join(' ')
    return tail ? { label: head, subtitle: clampSubtitle(tail) } : { label: head }
  }
  return { label: t }
}

function extractBracketTitle(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  const m = t.match(/\[([^\]]+)\]/)
  if (m?.[1]) return m[1].trim()
  return t
}

function parseNodeToken(token: string): { id: string; label: string; subtitle?: string; shape: MermaidNodeShape; explicit: boolean } | null {
  const raw = token.trim()

  // A[文本]
  let m = raw.match(/^([a-zA-Z0-9_]+)\[([^\]]+)\]$/)
  if (m) {
    const ls = splitLabelAndSubtitle(m[2])
    return { id: m[1], label: ls.label, subtitle: ls.subtitle, shape: 'rect', explicit: true }
  }

  // A(文本)
  m = raw.match(/^([a-zA-Z0-9_]+)\(([^)]+)\)$/)
  if (m) {
    const ls = splitLabelAndSubtitle(m[2])
    return { id: m[1], label: ls.label, subtitle: ls.subtitle, shape: 'circle', explicit: true }
  }

  // A{文本}
  m = raw.match(/^([a-zA-Z0-9_]+)\{([^}]+)\}$/)
  if (m) {
    const ls = splitLabelAndSubtitle(m[2])
    return { id: m[1], label: ls.label, subtitle: ls.subtitle, shape: 'diamond', explicit: true }
  }

  // A
  m = raw.match(/^([a-zA-Z0-9_]+)$/)
  if (m) return { id: m[1], label: m[1], shape: 'rect', explicit: false }

  return null
}

function parseEdgeLine(line: string): { left: string; right: string; label?: string } | null {
  // A -->|文案| B
  const labeled = line.match(/^(.*?)\s*-->\s*\|\s*(.+?)\s*\|\s*(.*?)$/)
  if (labeled) {
    return { left: labeled[1].trim(), right: labeled[3].trim(), label: labeled[2].trim() }
  }

  // A --> B
  const plain = line.match(/^(.*?)\s*-->\s*(.*?)$/)
  if (plain) {
    return { left: plain[1].trim(), right: plain[2].trim() }
  }

  return null
}

function pushNode(
  state: ParserState,
  node: MermaidIRNode,
  nodeMap: Map<string, MermaidIRNode>,
  currentSubgraphId: string | undefined,
  lineRaw: string,
) {
  const existing = nodeMap.get(node.id)
  const nextNode = currentSubgraphId ? { ...node, subgraphId: currentSubgraphId } : node

  if (!existing) {
    nodeMap.set(node.id, nextNode)
    state.nodes.push(nextNode)
    return
  }

  if (existing.label !== nextNode.label) {
    state.warnings.push({
      code: 'NODE_LABEL_CONFLICT',
      message: `Node ${node.id} declared multiple times with different labels: ${existing.label} / ${nextNode.label}`,
      line: node.line,
      raw: lineRaw,
    })
  }

  // first declaration wins; but we allow setting subgraph if first one was top-level
  if (!existing.subgraphId && currentSubgraphId) {
    existing.subgraphId = currentSubgraphId
  }
}

export function parseMermaidFlowchart(input: string): ParseMermaidResult {
  const normalized = normalizeMermaid(input)
  const lines = normalized.split('\n')

  const state: ParserState = {
    direction: 'TB',
    subgraphs: [],
    nodes: [],
    edges: [],
    warnings: [],
    errors: [],
  }

  const nodeMap = new Map<string, MermaidIRNode>()
  const subgraphStack: MermaidIRSubgraph[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const line = raw.trim()
    const lineNo = i + 1

    if (!line) continue
    if (line.startsWith('%%')) continue

    const direction = parseDirectionDecl(line)
    if (direction) {
      state.direction = direction
      continue
    }

    // flowchart but invalid direction => warning (not fatal)
    if (/^(flowchart|graph)\b/i.test(line)) {
      state.warnings.push({
        code: 'UNSUPPORTED_FLOWCHART_DECL',
        message: `Unsupported or invalid flowchart declaration in v1: ${line}`,
        line: lineNo,
        raw,
      })
      continue
    }

    const subgraphMatch = line.match(/^subgraph\s+(.+)$/i)
    if (subgraphMatch) {
      const title = extractBracketTitle(subgraphMatch[1].trim())
      const parentSubgraphId = subgraphStack[subgraphStack.length - 1]?.id
      const sg: MermaidIRSubgraph = {
        id: `subgraph_${slug(title) || String(state.subgraphs.length + 1)}`,
        title,
        nodeIds: [],
        ...(parentSubgraphId ? { parentSubgraphId } : {}),
        line: lineNo,
        raw,
      }
      state.subgraphs.push(sg)
      subgraphStack.push(sg)
      continue
    }

    if (/^end$/i.test(line)) {
      if (!subgraphStack.length) {
        state.warnings.push({
          code: 'UNMATCHED_END',
          message: 'Found end without matching subgraph',
          line: lineNo,
          raw,
        })
      } else {
        subgraphStack.pop()
      }
      continue
    }

    // unsupported syntax: warn and continue
    if (/^(classDef|style|linkStyle|click)\b/i.test(line) || /:::/i.test(line)) {
      state.warnings.push({
        code: 'UNSUPPORTED_SYNTAX',
        message: `Unsupported Mermaid syntax in v1: ${line}`,
        line: lineNo,
        raw,
      })
      continue
    }

    const edgeParsed = parseEdgeLine(line)
    if (edgeParsed) {
      const currentSubgraphId = subgraphStack[subgraphStack.length - 1]?.id

      const leftNode = parseNodeToken(edgeParsed.left)
      const rightNode = parseNodeToken(edgeParsed.right)

      if (!leftNode || !rightNode) {
        // not fatal: warn and continue
        state.warnings.push({
          code: 'INVALID_EDGE_SYNTAX',
          message: `Failed to parse edge line in v1: ${line}`,
          line: lineNo,
          raw,
        })
        continue
      }

      pushNode(
        state,
        {
          id: leftNode.id,
          label: leftNode.label,
          ...(leftNode.subtitle ? { subtitle: leftNode.subtitle } : {}),
          shape: leftNode.shape,
          line: lineNo,
          raw,
        },
        nodeMap,
        currentSubgraphId,
        raw,
      )
      pushNode(
        state,
        {
          id: rightNode.id,
          label: rightNode.label,
          ...(rightNode.subtitle ? { subtitle: rightNode.subtitle } : {}),
          shape: rightNode.shape,
          line: lineNo,
          raw,
        },
        nodeMap,
        currentSubgraphId,
        raw,
      )

      if (currentSubgraphId) {
        const sg = subgraphStack[subgraphStack.length - 1]
        if (sg) {
          if (!sg.nodeIds.includes(leftNode.id)) sg.nodeIds.push(leftNode.id)
          if (!sg.nodeIds.includes(rightNode.id)) sg.nodeIds.push(rightNode.id)
        }
      }

      state.edges.push({
        source: leftNode.id,
        target: rightNode.id,
        label: edgeParsed.label,
        line: lineNo,
        raw,
      })
      continue
    }

    const singleNode = parseNodeToken(line)
    if (singleNode) {
      const currentSubgraphId = subgraphStack[subgraphStack.length - 1]?.id
      pushNode(
        state,
        {
          id: singleNode.id,
          label: singleNode.label,
          ...(singleNode.subtitle ? { subtitle: singleNode.subtitle } : {}),
          shape: singleNode.shape,
          line: lineNo,
          raw,
        },
        nodeMap,
        currentSubgraphId,
        raw,
      )

      if (currentSubgraphId) {
        const sg = subgraphStack[subgraphStack.length - 1]
        if (sg && !sg.nodeIds.includes(singleNode.id)) sg.nodeIds.push(singleNode.id)
      }
      continue
    }

    state.warnings.push({
      code: 'UNRECOGNIZED_LINE',
      message: `Unrecognized Mermaid line in v1: ${line}`,
      line: lineNo,
      raw,
    })
  }

  if (subgraphStack.length > 0) {
    // structural issue: keep parsing result but mark error (fatal for transpile/apply)
    const sg = subgraphStack[subgraphStack.length - 1]
    state.errors.push({
      code: 'UNCLOSED_SUBGRAPH',
      message: `Subgraph not closed: ${sg.title}`,
      line: sg.line,
      raw: sg.raw,
    })
  }

  const ir: MermaidFlowIR = {
    direction: state.direction,
    subgraphs: state.subgraphs,
    nodes: state.nodes,
    edges: state.edges,
  }

  // Only fatal structural errors make success=false
  if (state.errors.length > 0) {
    return { success: false, ir: null, warnings: state.warnings, errors: state.errors }
  }

  return { success: true, ir, warnings: state.warnings, errors: [] }
}