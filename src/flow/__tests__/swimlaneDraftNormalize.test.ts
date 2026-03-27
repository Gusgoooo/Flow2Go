import { describe, expect, it } from 'vitest'
import { buildSwimlaneDraftFromPrompt, normalizeSwimlaneDraftCandidate } from '../swimlaneDraft'

describe('normalizeSwimlaneDraftCandidate', () => {
  it('converts logic-schema nodes/edges into Flow2Go draft schema', () => {
    const raw = {
      title: '电商订单处理',
      direction: 'horizontal',
      lanes: ['用户', '系统'],
      nodes: [
        { id: 'n1', label: '开始', lane: '用户', type: 'start_end' },
        { id: 'n2', label: '提交订单', lane: '用户', type: 'process' },
        { id: 'n3', label: '库存校验', lane: '系统', type: 'decision' },
      ],
      edges: [
        { from: 'n1', to: 'n2', relation: 'next' },
        { from: 'n2', to: 'n3', relation: 'submit_to' },
      ],
    }

    const normalized = normalizeSwimlaneDraftCandidate(raw)
    expect(Array.isArray(normalized.lanes)).toBe(true)
    expect(Array.isArray(normalized.nodes)).toBe(true)
    expect(Array.isArray(normalized.edges)).toBe(true)
    expect(normalized.nodes[0].title).toBe('开始')
    expect(normalized.nodes[0].semanticType).toBe('start')
    expect(normalized.nodes[2].semanticType).toBe('decision')
    expect(normalized.nodes[2].shape).toBe('diamond')
    expect(normalized.edges[0].source).toBe('n1')
    expect(normalized.edges[0].target).toBe('n2')
    expect(normalized.edges[1].semanticType).toBe('crossLane')
  })

  it('maps relation yes/no and return_to to semantic types and labels', () => {
    const raw = {
      title: '审批流',
      nodes: [
        { id: 'd1', label: '是否通过', lane: '审批人', type: 'decision' },
        { id: 'a1', label: '通过', lane: '审批人', type: 'process' },
        { id: 'r1', label: '退回补充', lane: '申请人', type: 'process' },
      ],
      edges: [
        { from: 'd1', to: 'a1', relation: 'yes' },
        { from: 'd1', to: 'r1', relation: 'no' },
        { from: 'r1', to: 'd1', relation: 'return_to' },
      ],
    }

    const normalized = normalizeSwimlaneDraftCandidate(raw)
    expect(normalized.edges[0].semanticType).toBe('conditional')
    expect(normalized.edges[0].label).toBe('是')
    expect(normalized.edges[1].semanticType).toBe('conditional')
    expect(normalized.edges[1].label).toBe('否')
    expect(normalized.edges[2].semanticType).toBe('returnFlow')
  })

  it('hides machine relation labels such as next/submit_to on rendered edges', () => {
    const raw = {
      title: '标签清洗',
      nodes: [
        { id: 'n1', label: '开始', lane: '用户', type: 'start_end' },
        { id: 'n2', label: '提交', lane: '用户', type: 'process' },
        { id: 'n3', label: '处理', lane: '系统', type: 'process' },
      ],
      edges: [
        { from: 'n1', to: 'n2', relation: 'next', label: 'next' },
        { from: 'n2', to: 'n3', relation: 'submit_to', label: 'submit_to' },
      ],
    }

    const normalized = normalizeSwimlaneDraftCandidate(raw)
    expect(normalized.edges[0].label).toBeUndefined()
    expect(normalized.edges[1].label).toBeUndefined()
    expect(normalized.edges[1].semanticType).toBe('crossLane')
  })

  it('reindexes lane order continuously from 0', () => {
    const raw = {
      title: '泳道顺序',
      lanes: [
        { id: 'lane-b', title: 'B', order: 9 },
        { id: 'lane-a', title: 'A', order: 3 },
      ],
      nodes: [
        { id: 'n1', label: '开始', lane: 'A', type: 'start_end' },
        { id: 'n2', label: '处理', lane: 'B', type: 'process' },
      ],
      edges: [{ from: 'n1', to: 'n2', relation: 'submit_to' }],
    }

    const normalized = normalizeSwimlaneDraftCandidate(raw)
    expect(normalized.lanes[0].order).toBe(0)
    expect(normalized.lanes[1].order).toBe(1)
  })

  it('does not auto-create cross-lane returnFlow when no same-lane upstream exists in prompt fallback', () => {
    const draft = buildSwimlaneDraftFromPrompt([
      '用户: 提交申请',
      '系统: 审核资料',
      '财务: 驳回并回流',
    ].join('\n'))

    const returnFlows = draft.edges.filter((edge) => edge.semanticType === 'returnFlow')
    expect(returnFlows).toHaveLength(0)
  })
})
