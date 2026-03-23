import type { AiDiagramSceneHint } from '../aiDiagram'
import { AI_SCENE_CAPSULE_ACCENT_COLORS } from '../ColorEditor'

export type { AiDiagramSceneHint }

export type AiSceneCapsulePreset = {
  id: string
  label: string
  scene: AiDiagramSceneHint
  /** 与 ColorEditor 预设色板一致，用于胶囊选中描边 + 6% 浅底 */
  accentHex: string
  prompt: string
}

/**
 * 场景胶囊：业务分层大图 / 思维导图 / 流程图
 * 文案为自然语言预设，用户可删改；生成时通过 diagramScene 强制路由。
 */
export const AI_SCENE_CAPSULE_PRESETS: AiSceneCapsulePreset[] = [
  {
    id: 'business-big-map',
    label: '业务分层大图',
    scene: 'business-big-map',
    accentHex: AI_SCENE_CAPSULE_ACCENT_COLORS[0],
    prompt: [
      '请帮我在 Flow2Go 里生成一张「业务分层大图」：整体自上而下按章节画框排版，用多层 subgraph 表达战略全景 / 能力地图式的层级关系；节点标题尽量短（建议 2～6 个字），用分组与嵌套表达归属，不要依赖大量连线。',
      '',
      '【主题 / 领域】',
      '（请写一句话，例如：某 SaaS 产品的平台能力总览、某公司数字化转型板块、某业务域端到端能力拆解）',
      '',
      '【希望覆盖的板块或关键词】（可选，列 3～8 条即可）',
      '（例如：获客、交易、履约、风控、数据、组织与治理……）',
      '',
      '【补充约束】（可选）',
      '（例如：偏对内管理视角、偏客户旅程、需要体现与外部系统的边界等）',
    ].join('\n'),
  },
  {
    id: 'mind-map',
    label: '思维导图',
    scene: 'mind-map',
    accentHex: AI_SCENE_CAPSULE_ACCENT_COLORS[1],
    prompt: [
      '请以「思维导图」方式整理下面的主题：从中心主题向右（或向四周）做树状发散，至少包含三层（根 → 一级分支 → 子要点）；每个节点用简短中文短语，体现分类、并列或递进关系即可。',
      '',
      '【中心主题】',
      '（一句话写清楚要拆解的核心主题）',
      '',
      '【希望展开的大类方向】（可选，3～6 个关键词）',
      '（例如：目标用户、核心场景、关键能力、风险点、指标与度量……）',
      '',
      '【备注】',
      '不要画成按时间顺序的步骤流程图；重点是结构拆分与归类。',
    ].join('\n'),
  },
  {
    id: 'flowchart',
    label: '流程图',
    scene: 'flowchart',
    accentHex: AI_SCENE_CAPSULE_ACCENT_COLORS[3],
    prompt: [
      '请生成一张流程图：结构保持清晰分组与主链路；布局采用 Dagre（Graph layout for JavaScript）进行排版。',
      '',
      '【要描述的过程】',
      '（一句话写清流程主题）',
      '',
      '【涉及角色 / 系统】（可选）',
      '（例如：用户、前端、服务、数据库、第三方）',
      '',
      '【特别关注】（可选）',
      '（例如：异常与回退、需要审计节点、与第三方回调衔接）',
    ].join('\n'),
  },
]

/** @deprecated 旧多胶囊列表已收敛为 AI_SCENE_CAPSULE_PRESETS */
export type AiPromptPreset = AiSceneCapsulePreset

/** @deprecated */
export const AI_PROMPT_PRESETS: AiSceneCapsulePreset[] = AI_SCENE_CAPSULE_PRESETS

/** @deprecated */
export const DEFAULT_AI_PROMPT_PRESET_ID = 'business-big-map'

/** @deprecated */
export const DEFAULT_AI_PROMPT =
  AI_SCENE_CAPSULE_PRESETS.find((p) => p.id === DEFAULT_AI_PROMPT_PRESET_ID)?.prompt ??
  AI_SCENE_CAPSULE_PRESETS[0]?.prompt ??
  ''
