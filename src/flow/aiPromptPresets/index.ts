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
 * 场景胶囊：业务分层大图 / ELK 业务大图（实验）/ 思维导图 / 流程图
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
    id: 'business-big-map-elk',
    label: 'ELK业务大图（测试）',
    scene: 'business-big-map-elk',
    accentHex: AI_SCENE_CAPSULE_ACCENT_COLORS[3],
    prompt: [
      '【实验】请生成一张「业务分层大图」主题的结构图：与常规业务大图相同的 Planner + subgraph 嵌套语义，但物化阶段走内置 ELK layered 自动排版，不做旧版业务大图画布归一化；仍用分组与嵌套表达归属，不要输出连线。',
      '',
      '【主题 / 领域】',
      '（一句话描述要展示的业务域或能力全景）',
      '',
      '【希望覆盖的板块】（可选，3～8 条关键词）',
      '',
      '【备注】',
      '此为排版管线对比测试；若与「业务分层大图」胶囊效果不同属预期。',
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
    accentHex: AI_SCENE_CAPSULE_ACCENT_COLORS[2],
    prompt: [
      '请生成一张「流程图」：用 flowchart 表达主流程与关键阶段；优先用 subgraph 划分阶段或责任边界，主链路从左到右（或自上而下）清晰可读；分支与回流只保留最关键的一两条，边上用简短中文写清动作或结果。',
      '',
      '【要描述的过程】',
      '（例如：用户从注册 → 下单 → 支付 → 发货 → 售后的主路径；或审批从提交到归档的链路）',
      '',
      '【涉及角色 / 系统】（可选）',
      '（例如：用户、运营、支付网关、订单服务、仓储系统……）',
      '',
      '【特别关注】（可选）',
      '（例如：异常与回退、需要审计的节点、与第三方回调的衔接等）',
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
