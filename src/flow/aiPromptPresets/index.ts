import agentWorkflowPrompt from './agent-workflow.md?raw'
import approvalWorkflowPrompt from './approval-workflow.md?raw'
import businessTreePrompt from './business-tree.md?raw'
import dataPipelinePrompt from './data-pipeline.md?raw'
import productRoadmapPrompt from './product-roadmap.md?raw'
import systemArchitecturePrompt from './system-architecture.md?raw'
import userJourneyPrompt from './user-journey.md?raw'

export type AiPromptPreset = {
  id: string
  label: string
  prompt: string
}

export const AI_PROMPT_PRESETS: AiPromptPreset[] = [
  { id: 'business-tree', label: '业务树图', prompt: businessTreePrompt.trim() },
  { id: 'system-architecture', label: '系统架构', prompt: systemArchitecturePrompt.trim() },
  { id: 'data-pipeline', label: '数据管道', prompt: dataPipelinePrompt.trim() },
  { id: 'user-journey', label: '用户旅程', prompt: userJourneyPrompt.trim() },
  { id: 'agent-workflow', label: '多Agent', prompt: agentWorkflowPrompt.trim() },
  { id: 'approval-workflow', label: '审批流程', prompt: approvalWorkflowPrompt.trim() },
  { id: 'product-roadmap', label: '产品路线图', prompt: productRoadmapPrompt.trim() },
]

export const DEFAULT_AI_PROMPT_PRESET_ID = 'business-tree'

export const DEFAULT_AI_PROMPT =
  AI_PROMPT_PRESETS.find((preset) => preset.id === DEFAULT_AI_PROMPT_PRESET_ID)?.prompt ?? AI_PROMPT_PRESETS[0]?.prompt ?? ''
