/**
 * 泳道图最小验收示例。
 * 3 条泳道（用户 / 系统 / 审核员）+ 5 个步骤 + 1 条回流边。
 */
import type { SwimlaneDraft } from './swimlaneDraft'

export const SWIMLANE_EXAMPLE_DRAFT: SwimlaneDraft = {
  title: '审批流程泳道图',
  direction: 'horizontal',
  lanes: [
    { id: 'lane-user', title: '用户', order: 0 },
    { id: 'lane-system', title: '系统', order: 1 },
    { id: 'lane-reviewer', title: '审核员', order: 2 },
  ],
  nodes: [
    {
      id: 'n-submit',
      title: '提交申请',
      laneId: 'lane-user',
      semanticType: 'start',
      order: 0,
    },
    {
      id: 'n-validate',
      title: '校验资料',
      laneId: 'lane-system',
      semanticType: 'task',
      order: 1,
    },
    {
      id: 'n-review',
      title: '人工审核',
      laneId: 'lane-reviewer',
      semanticType: 'decision',
      order: 2,
    },
    {
      id: 'n-result',
      title: '返回结果',
      laneId: 'lane-system',
      semanticType: 'task',
      order: 3,
    },
    {
      id: 'n-view',
      title: '查看结果',
      laneId: 'lane-user',
      semanticType: 'end',
      order: 4,
    },
  ],
  edges: [
    { id: 'e1', source: 'n-submit', target: 'n-validate', label: '' },
    { id: 'e2', source: 'n-validate', target: 'n-review', label: '' },
    { id: 'e3', source: 'n-review', target: 'n-result', label: '通过' },
    { id: 'e4', source: 'n-result', target: 'n-view', label: '' },
    {
      id: 'e5',
      source: 'n-review',
      target: 'n-submit',
      label: '驳回补充',
      semanticType: 'returnFlow',
    },
  ],
}
