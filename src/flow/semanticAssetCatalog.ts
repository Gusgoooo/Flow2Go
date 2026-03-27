import type { SemanticPipeline } from './semanticAsset'

type RulePack = {
  id: string
  version: string
  pipeline: SemanticPipeline
}

const RULE_PACKS: RulePack[] = [
  { id: 'auto-default', version: '1.0.0', pipeline: 'auto' },
  { id: 'flowchart-default', version: '1.0.0', pipeline: 'flowchart' },
  { id: 'mind-map-default', version: '1.0.0', pipeline: 'mind-map' },
  { id: 'swimlane-text-default', version: '1.0.0', pipeline: 'swimlane-text' },
  { id: 'swimlane-image-default', version: '1.0.0', pipeline: 'swimlane-image' },
  { id: 'free-layout-image-default', version: '1.0.0', pipeline: 'free-layout-image' },
]

export function getSemanticAssetCatalog() {
  return { rulePacks: RULE_PACKS }
}

export function getRulePackByPipeline(pipeline: SemanticPipeline): RulePack {
  return RULE_PACKS.find((r) => r.pipeline === pipeline) ?? RULE_PACKS[0]
}

export function validateSemanticAssetCatalog() {
  const hasDup = new Set<string>()
  for (const r of RULE_PACKS) {
    const key = `${r.pipeline}:${r.id}`
    if (hasDup.has(key)) return { ok: false as const, errors: [`duplicate rule pack: ${key}`] }
    hasDup.add(key)
  }
  return { ok: true as const, errors: [] as string[] }
}

