/**
 * Layout Selector / Scene Layout Profile（与节点 schema 无关的轻量决策）
 */

export type LayoutEngine = 'native' | 'elk' | 'mind-elixir'

/** 布局语义模式（指导 Mermaid 生成与后续渲染偏好，非 ELK 算法名） */
export type LayoutMode = 'tree' | 'layered' | 'chaptered' | 'horizontal' | 'vertical'

/** 与 Scene Router / Planner 对齐：normal ≈ 原 chapters（更章节化） */
export type ComplexityModePublic = 'compact' | 'normal'

/** Planner 内部仍使用 compact | chapters */
export type PlannerComplexityMode = 'compact' | 'chapters'

/** 非业务大图、非思维导图的流程类布局 profile（原 6 个通用模板名保留作 id） */
export const LAYOUT_PROFILE_KEYS = [
  'Frontend-Backend Flow Template',
  'Data Pipeline Flow Template',
  'Agent Workflow Template',
  'Approval Workflow Template',
  'System Architecture Template',
  'User Journey Template',
] as const

export type LayoutProfileKey = (typeof LAYOUT_PROFILE_KEYS)[number]

export type GenerationPipeline = 'flowchart' | 'mind-map' | 'business-big-map'

export type LayoutDecision = {
  diagramType: 'flowchart' | 'mind-map' | 'business-big-map'
  layoutEngine: LayoutEngine
  layoutMode: LayoutMode
  complexityMode: ComplexityModePublic
  /** flowchart 时为 LayoutProfileKey；特殊管道时为占位 */
  profileId: string
  preserveBusinessBigMap: boolean
}

export type SceneRouteV2 = {
  sceneKind:
    | 'business-big-map'
    | 'agent-flow'
    | 'approval-flow'
    | 'data-pipeline'
    | 'business-flow'
    | 'hierarchy'
    | 'mind-map'
    | 'other'
  complexityMode: ComplexityModePublic | PlannerComplexityMode
  layoutProfileKey: LayoutProfileKey | null
  pipeline: GenerationPipeline
}

export function isLayoutProfileKey(s: string): s is LayoutProfileKey {
  return (LAYOUT_PROFILE_KEYS as readonly string[]).includes(s)
}

export function toPlannerComplexity(mode: SceneRouteV2['complexityMode']): PlannerComplexityMode {
  if (mode === 'chapters' || mode === 'normal') return 'chapters'
  return 'compact'
}

export function toPublicComplexity(mode: SceneRouteV2['complexityMode']): ComplexityModePublic {
  if (mode === 'chapters') return 'normal'
  return mode === 'normal' ? 'normal' : 'compact'
}

/**
 * 由场景与 profile 解析轻量布局决策（不替代 business_big_map 专属后处理）
 */
export function resolveLayoutDecision(route: SceneRouteV2): LayoutDecision {
  if (route.pipeline === 'business-big-map') {
    return {
      diagramType: 'business-big-map',
      layoutEngine: 'elk',
      layoutMode: 'chaptered',
      complexityMode: toPublicComplexity(route.complexityMode),
      profileId: 'business-big-map',
      preserveBusinessBigMap: true,
    }
  }
  if (route.pipeline === 'mind-map') {
    return {
      diagramType: 'mind-map',
      layoutEngine: 'mind-elixir',
      layoutMode: 'tree',
      complexityMode: toPublicComplexity(route.complexityMode),
      profileId: 'mind-map',
      preserveBusinessBigMap: false,
    }
  }

  const profile = route.layoutProfileKey ?? 'Frontend-Backend Flow Template'
  const { layoutMode, layoutEngine } = inferFlowLayoutMode(route.sceneKind, profile)

  return {
    diagramType: 'flowchart',
    layoutEngine,
    layoutMode,
    complexityMode: toPublicComplexity(route.complexityMode),
    profileId: profile,
    preserveBusinessBigMap: false,
  }
}

function inferFlowLayoutMode(
  sceneKind: SceneRouteV2['sceneKind'],
  _profile: LayoutProfileKey,
): { layoutMode: LayoutMode; layoutEngine: LayoutEngine } {
  void _profile
  if (sceneKind === 'data-pipeline' || sceneKind === 'business-flow') {
    return { layoutMode: 'layered', layoutEngine: 'elk' }
  }
  if (sceneKind === 'hierarchy') {
    return { layoutMode: 'tree', layoutEngine: 'elk' }
  }
  if (sceneKind === 'agent-flow' || sceneKind === 'approval-flow') {
    return { layoutMode: 'layered', layoutEngine: 'elk' }
  }
  return { layoutMode: 'layered', layoutEngine: 'elk' }
}

/** 将旧版 templateKey（8 选 1）转为 SceneRouteV2 */
export function sceneRouteFromLegacyTemplateKey(
  templateKey: string,
  complexityMode: PlannerComplexityMode,
): SceneRouteV2 {
  const cm: SceneRouteV2['complexityMode'] = complexityMode
  if (templateKey === 'Business Big Map Template') {
    return {
      sceneKind: 'business-big-map',
      complexityMode: cm,
      layoutProfileKey: null,
      pipeline: 'business-big-map',
    }
  }
  if (templateKey === 'Mind Map Template') {
    return {
      sceneKind: 'mind-map',
      complexityMode: cm,
      layoutProfileKey: null,
      pipeline: 'mind-map',
    }
  }
  if (isLayoutProfileKey(templateKey)) {
    return {
      sceneKind: inferSceneKindFromProfile(templateKey),
      complexityMode: cm,
      layoutProfileKey: templateKey,
      pipeline: 'flowchart',
    }
  }
  return {
    sceneKind: 'other',
    complexityMode: cm,
    layoutProfileKey: 'Frontend-Backend Flow Template',
    pipeline: 'flowchart',
  }
}

function inferSceneKindFromProfile(k: LayoutProfileKey): SceneRouteV2['sceneKind'] {
  if (k.includes('Data Pipeline')) return 'data-pipeline'
  if (k.includes('Agent')) return 'agent-flow'
  if (k.includes('Approval')) return 'approval-flow'
  if (k.includes('System Architecture')) return 'business-flow'
  if (k.includes('User Journey')) return 'other'
  if (k.includes('Frontend-Backend')) return 'business-flow'
  return 'other'
}
