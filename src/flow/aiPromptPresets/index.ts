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
 * 场景胶囊：思维导图 / 流程图
 * 文案为自然语言预设，用户可删改；生成时通过 diagramScene 强制路由。
 */
export const AI_SCENE_CAPSULE_PRESETS: AiSceneCapsulePreset[] = [
  {
    id: 'swimlane',
    label: '泳道图',
    scene: 'swimlane' as AiDiagramSceneHint,
    accentHex: AI_SCENE_CAPSULE_ACCENT_COLORS[2],
    prompt: [
      '【示例】请帮我生成一张"审批流程泳道图"。',
      '',
      '泳道（参与角色）：',
      '- 用户',
      '- 系统',
      '- 审核员',
      '',
      '流程如下：',
      '1. 用户提交申请',
      '2. 系统校验资料',
      '3. 审核员人工审核',
      '4. 系统返回结果',
      '5. 用户查看结果',
      '',
      '如果审核不通过，审核员驳回后用户需要重新提交申请。',
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
      '【示例】请帮我生成一张“电商订单支付与发货流程图”。',
      '',
      '流程如下：',
      '用户在商品详情页点击“立即购买”，进入订单确认页，确认收货地址、商品信息和支付方式后提交订单。系统先校验库存是否充足，如果库存不足，则提示“库存不足”并结束流程；如果库存充足，则创建待支付订单。创建订单后，系统发起支付请求，并判断支付是否成功。',
      '',
      '如果支付失败，则将订单状态更新为“支付失败”，并允许用户重新支付。用户重新支付后，再次进入支付结果判断；如果用户放弃支付，则订单关闭，流程结束。',
      '',
      '如果支付成功，则将订单状态更新为“已支付”，并继续进行库存扣减。系统扣减库存时，如果扣减失败，则触发退款流程，并将订单状态更新为“退款中”；如果扣减成功，则进入发货流程。',
      '',
      '发货前，系统先判断商家是否在规定时间内处理订单。如果商家超时未处理，则触发催单提醒；催单后如果商家补处理成功，则回到正常发货流程；如果催单后仍未处理，则升级为异常订单，交由人工客服介入。人工客服介入后，如果协调成功，则回到发货流程；如果协调失败，则进入取消订单并退款流程。',
      '',
      '商家处理订单后进入出库环节。系统判断出库是否成功。如果出库失败，则将订单标记为“发货异常”，通知商家重新处理；商家重新处理后，再次进入出库判断。如果连续多次出库失败，则升级为人工处理。人工处理后，如果处理成功，则继续发货；如果处理失败，则取消订单并进入退款流程。',
      '',
      '出库成功后，系统生成物流单号并更新订单状态为“待收货”。用户收货后，系统判断用户是否确认收货。如果用户确认收货，则订单状态更新为“已完成”；如果用户在规定时间内未确认收货，则系统自动确认收货，订单也更新为“已完成”。',
      '',
      '补充流程：',
      '1. 如果用户在支付后主动申请取消订单，系统需要判断订单是否已经发货；如果未发货，则允许取消并进入退款流程；如果已发货，则不允许取消，并引导用户进入售后流程。',
      '2. 如果退款流程被触发，系统需要调用支付系统原路退款；若退款成功，则订单状态更新为“已退款”；若退款失败，则进入人工财务处理。',
      '3. 人工财务处理后，如果处理成功，则更新为“已退款”；如果处理失败，则记录异常原因，并回流到财务复核节点再次处理；若复核后仍失败，则升级为异常工单。',
      '4. 所有异常状态都需要通知相关角色。',
      '5. 所有人工处理节点，如果处理成功，都应尽量回流到原正常主流程，而不是直接结束。',
    ].join('\n'),
  },
  {
    id: 'flowchart-json-test',
    label: '流程图JSON测试',
    scene: 'flowchart-json-test' as AiDiagramSceneHint,
    accentHex: AI_SCENE_CAPSULE_ACCENT_COLORS[0],
    prompt: [
      '请把以下业务过程整理为流程图（JSON测试链路）：',
      '',
      '用户提交申请 -> 系统校验 -> 审核员审批 -> 系统通知结果。',
      '若审批驳回，用户补充材料后重新提交。',
      '若系统校验失败，返回错误并允许用户重试。',
    ].join('\n'),
  },
]

/** @deprecated 旧多胶囊列表已收敛为 AI_SCENE_CAPSULE_PRESETS */
export type AiPromptPreset = AiSceneCapsulePreset

/** @deprecated */
export const AI_PROMPT_PRESETS: AiSceneCapsulePreset[] = AI_SCENE_CAPSULE_PRESETS

/** @deprecated */
export const DEFAULT_AI_PROMPT_PRESET_ID = 'flowchart'

/** @deprecated */
export const DEFAULT_AI_PROMPT =
  AI_SCENE_CAPSULE_PRESETS.find((p) => p.id === DEFAULT_AI_PROMPT_PRESET_ID)?.prompt ??
  AI_SCENE_CAPSULE_PRESETS[0]?.prompt ??
  ''
