import { describe, expect, it } from 'vitest'
import { swimlaneDraftToGraphBatchPayload, type SwimlaneDraft } from '../swimlaneDraft'

function nodeStyleFromPayload(payload: ReturnType<typeof swimlaneDraftToGraphBatchPayload>, nodeId: string): Record<string, any> {
  const op = payload.operations.find((item) => item.op === 'graph.createNodeQuad' && item.params.id === nodeId)
  if (!op || op.op !== 'graph.createNodeQuad') throw new Error(`node op not found: ${nodeId}`)
  return ((op.params.style ?? {}) as Record<string, any>)
}

function edgeStyleFromPayload(payload: ReturnType<typeof swimlaneDraftToGraphBatchPayload>, edgeId: string): Record<string, any> {
  const op = payload.operations.find((item) => item.op === 'graph.createEdge' && item.params.id === edgeId)
  if (!op || op.op !== 'graph.createEdge') throw new Error(`edge op not found: ${edgeId}`)
  return ((op.params.style ?? {}) as Record<string, any>)
}

describe('swimlane draft lane heuristics', () => {
  it('splits decision outgoing targets into different rows only when same-row same-col collision exists', () => {
    const draft: SwimlaneDraft = {
      title: 'decision split',
      direction: 'horizontal',
      lanes: [{ id: 'lane-system', title: '系统', order: 0 }],
      nodes: [
        { id: 'D', title: '是否通过', laneId: 'lane-system', semanticType: 'decision', order: 0 },
        { id: 'Y', title: '执行成功', laneId: 'lane-system', semanticType: 'task', order: 1, laneCol: 1 },
        { id: 'N', title: '执行失败', laneId: 'lane-system', semanticType: 'task', order: 2, laneCol: 1 },
      ],
      edges: [
        { id: 'e-dy', source: 'D', target: 'Y', semanticType: 'conditional' },
        { id: 'e-dn', source: 'D', target: 'N', semanticType: 'conditional' },
      ],
    }

    const payload = swimlaneDraftToGraphBatchPayload(draft)
    const yStyle = nodeStyleFromPayload(payload, 'Y')
    const nStyle = nodeStyleFromPayload(payload, 'N')
    expect(yStyle.laneRow).not.toBe(nStyle.laneRow)
  })

  it('moves skipped middle node below target column for A->C skip edge', () => {
    const draft: SwimlaneDraft = {
      title: 'skip edge',
      direction: 'horizontal',
      lanes: [{ id: 'lane-system', title: '系统', order: 0 }],
      nodes: [
        { id: 'A', title: '开始', laneId: 'lane-system', semanticType: 'task', order: 0 },
        { id: 'B', title: '中间', laneId: 'lane-system', semanticType: 'task', order: 1 },
        { id: 'C', title: '结束', laneId: 'lane-system', semanticType: 'task', order: 2 },
      ],
      edges: [
        { id: 'e-ab', source: 'A', target: 'B', semanticType: 'normal' },
        { id: 'e-bc', source: 'B', target: 'C', semanticType: 'normal' },
        { id: 'e-ac', source: 'A', target: 'C', semanticType: 'normal' },
      ],
    }

    const payload = swimlaneDraftToGraphBatchPayload(draft)
    const bStyle = nodeStyleFromPayload(payload, 'B')
    const cStyle = nodeStyleFromPayload(payload, 'C')
    expect(bStyle.laneRow).toBeGreaterThan(cStyle.laneRow)
    expect(bStyle.laneCol).toBe(cStyle.laneCol)
  })

  it('does not force row wrapping for long skip edges beyond A->C pattern', () => {
    const draft: SwimlaneDraft = {
      title: 'long skip edge',
      direction: 'horizontal',
      lanes: [{ id: 'lane-system', title: '系统', order: 0 }],
      nodes: [
        { id: 'A', title: 'A', laneId: 'lane-system', semanticType: 'task', order: 0 },
        { id: 'B', title: 'B', laneId: 'lane-system', semanticType: 'task', order: 1 },
        { id: 'C', title: 'C', laneId: 'lane-system', semanticType: 'task', order: 2 },
        { id: 'D', title: 'D', laneId: 'lane-system', semanticType: 'task', order: 3 },
      ],
      edges: [
        { id: 'e-ab', source: 'A', target: 'B', semanticType: 'normal' },
        { id: 'e-bc', source: 'B', target: 'C', semanticType: 'normal' },
        { id: 'e-cd', source: 'C', target: 'D', semanticType: 'normal' },
        { id: 'e-ad', source: 'A', target: 'D', semanticType: 'normal' },
      ],
    }

    const payload = swimlaneDraftToGraphBatchPayload(draft)
    const bStyle = nodeStyleFromPayload(payload, 'B')
    const cStyle = nodeStyleFromPayload(payload, 'C')
    const dStyle = nodeStyleFromPayload(payload, 'D')
    expect(bStyle.laneRow).toBe(0)
    expect(cStyle.laneRow).toBe(0)
    expect(dStyle.laneRow).toBe(0)
  })

  it('does not split decision targets into rows when they already occupy different columns', () => {
    const draft: SwimlaneDraft = {
      title: 'decision no forced wrap',
      direction: 'horizontal',
      lanes: [{ id: 'lane-system', title: '系统', order: 0 }],
      nodes: [
        { id: 'D', title: '是否通过', laneId: 'lane-system', semanticType: 'decision', order: 0 },
        { id: 'Y', title: '通过处理', laneId: 'lane-system', semanticType: 'task', order: 1 },
        { id: 'N', title: '退回补充', laneId: 'lane-system', semanticType: 'task', order: 2 },
      ],
      edges: [
        { id: 'e-dy', source: 'D', target: 'Y', semanticType: 'conditional' },
        { id: 'e-dn', source: 'D', target: 'N', semanticType: 'conditional' },
      ],
    }

    const payload = swimlaneDraftToGraphBatchPayload(draft)
    const yStyle = nodeStyleFromPayload(payload, 'Y')
    const nStyle = nodeStyleFromPayload(payload, 'N')
    expect(yStyle.laneRow).toBe(0)
    expect(nStyle.laneRow).toBe(0)
  })

  it('fills explicit crossLane semanticType for cross-lane edges when semanticType is missing', () => {
    const draft: SwimlaneDraft = {
      title: 'cross lane semantic',
      direction: 'horizontal',
      lanes: [
        { id: 'lane-a', title: 'A', order: 0 },
        { id: 'lane-b', title: 'B', order: 1 },
      ],
      nodes: [
        { id: 'A1', title: 'A1', laneId: 'lane-a', semanticType: 'task', order: 0 },
        { id: 'B1', title: 'B1', laneId: 'lane-b', semanticType: 'task', order: 1 },
      ],
      edges: [{ id: 'e-a1-b1', source: 'A1', target: 'B1' }],
    }

    const payload = swimlaneDraftToGraphBatchPayload(draft)
    const op = payload.operations.find((item) => item.op === 'graph.createEdge' && item.params.id === 'e-a1-b1')
    if (!op || op.op !== 'graph.createEdge') throw new Error('edge op not found')
    expect((op.params.style as any)?.semanticType).toBe('crossLane')
  })

  it('writes laneId into node style for stable parentId + laneId mapping', () => {
    const draft: SwimlaneDraft = {
      title: 'lane id mapping',
      direction: 'horizontal',
      lanes: [{ id: 'lane-a', title: 'A', order: 0 }],
      nodes: [{ id: 'n1', title: '步骤', laneId: 'lane-a', semanticType: 'task', order: 0 }],
      edges: [],
    }

    const payload = swimlaneDraftToGraphBatchPayload(draft)
    const style = nodeStyleFromPayload(payload, 'n1')
    expect(style.laneId).toBe('lane-a')
  })

  it('keeps at most one cross-lane returnFlow edge for a cleaner generated draft', () => {
    const draft: SwimlaneDraft = {
      title: 'cross-lane return prune',
      direction: 'horizontal',
      lanes: [
        { id: 'lane-user', title: '用户', order: 0 },
        { id: 'lane-system', title: '系统', order: 1 },
        { id: 'lane-finance', title: '财务', order: 2 },
      ],
      nodes: [
        { id: 'U1', title: '提交', laneId: 'lane-user', semanticType: 'task', order: 0 },
        { id: 'S1', title: '审核', laneId: 'lane-system', semanticType: 'task', order: 1 },
        { id: 'F1', title: '复核', laneId: 'lane-finance', semanticType: 'task', order: 2 },
      ],
      edges: [
        { id: 'ret-1', source: 'S1', target: 'U1', semanticType: 'returnFlow', label: '驳回' },
        { id: 'ret-2', source: 'F1', target: 'U1', semanticType: 'returnFlow', label: '退回' },
      ],
    }

    const payload = swimlaneDraftToGraphBatchPayload(draft)
    const edgeOps = payload.operations.filter((item) => item.op === 'graph.createEdge') as Array<any>
    const crossLaneReturns = edgeOps.filter((op) => (op.params.style as any)?.semanticType === 'returnFlow')
    expect(crossLaneReturns).toHaveLength(1)
    expect(edgeStyleFromPayload(payload, 'ret-1').semanticType).toBe('returnFlow')
  })
})
