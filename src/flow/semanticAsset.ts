import type { AiDiagramDraft } from './aiDiagram'

export type SemanticPipeline =
  | 'auto'
  | 'flowchart'
  | 'mind-map'
  | 'swimlane-text'
  | 'swimlane-image'

export type SemanticPayloadFormat =
  | 'raw-text'
  | 'swimlane-draft'
  | 'image-structured'

export type SemanticRunBundle = {
  id: string
  createdAt: number
  pipeline: SemanticPipeline
  input: {
    projectId?: string
    prompt?: string
    sceneHint?: string
    textModel?: string
    visionModel?: string
    imageFingerprint?: string
  }
  semanticFormat: SemanticPayloadFormat
  semanticPayload: unknown
  output: {
    title?: string
    snapshot: {
      nodes: unknown[]
      edges: unknown[]
      viewport?: { x: number; y: number; zoom: number }
    }
    rawText?: string
  }
}

export function fingerprintDataUrl(dataUrl: string): string {
  let h = 0
  const s = dataUrl || ''
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `fp_${h.toString(16)}`
}

export function buildSemanticRunBundle(args: {
  pipeline: SemanticPipeline
  input: SemanticRunBundle['input']
  semanticFormat: SemanticPayloadFormat
  semanticPayload: unknown
  output: SemanticRunBundle['output']
}): SemanticRunBundle {
  return {
    id: `sem-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    pipeline: args.pipeline,
    input: args.input,
    semanticFormat: args.semanticFormat,
    semanticPayload: args.semanticPayload,
    output: args.output,
  }
}

export function draftToSemanticOutput(draft: AiDiagramDraft): SemanticRunBundle['output'] {
  return {
    title: draft.title,
    snapshot: {
      nodes: draft.nodes ?? [],
      edges: draft.edges ?? [],
      viewport: draft.viewport,
    },
    rawText: draft.rawText,
  }
}

