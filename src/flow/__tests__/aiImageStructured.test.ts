import { describe, expect, it } from 'vitest'
import {
  buildFreeLayoutDraftFromImageStructured,
  buildSwimlanePreserveLayoutDraftFromImageStructured,
  buildSwimlaneDraftFromImageStructured,
  refineImageStructuredDraft,
  validateImageStructuredDraft,
} from '../aiDiagram'
import { GRID_UNIT } from '../grid'

describe('ai image structured pipeline', () => {
  it('upgrades legacy v1 schema to v2 and injects confidence', () => {
    const draft = validateImageStructuredDraft(
      {
        schema: 'flow2go.image.structure.v1',
        sceneHint: 'auto',
        nodes: [{ id: 'n1', label: '开始', type: 'start_end', x: 0.1, y: 0.1, w: 0.1, h: 0.08 }],
        edges: [],
      },
      '{"schema":"flow2go.image.structure.v1"}',
    )
    expect(draft.schema).toBe('flow2go.image.structure.v2')
    expect(Array.isArray(draft.groups)).toBe(true)
    expect(draft.confidence).toBeTruthy()
    expect((draft.confidence?.overall ?? 0) > 0).toBe(true)
  })

  it('infers parent/lane by containment and normalizes colors', () => {
    const draft = validateImageStructuredDraft(
      {
        schema: 'flow2go.image.structure.v2',
        sceneHint: 'auto',
        lanes: ['市场专员', '财务'],
        groups: [
          { id: 'lane-1', label: '市场专员', kind: 'lane', x: 0.05, y: 0.08, w: 0.9, h: 0.36, style: { fill: '#ffeecc' } },
          { id: 'lane-2', label: '财务', kind: 'lane', x: 0.05, y: 0.46, w: 0.9, h: 0.36, style: { fill: '#eef6ff' } },
          { id: 'g-approve', label: '审批区', kind: 'group', x: 0.1, y: 0.12, w: 0.34, h: 0.24, style: { fill: 'rgb(255, 177, 0)' } },
        ],
        nodes: [
          { id: 'n-submit', label: '提交申请', type: 'process', x: 0.13, y: 0.18, w: 0.12, h: 0.06 },
          { id: 'n-review', label: '主管审核', type: 'decision', x: 0.28, y: 0.2, w: 0.1, h: 0.08, style: { fill: '#abc' } },
        ],
        edges: [{ from: 'n-submit', to: 'n-review', relation: 'next' }],
      },
      '{"schema":"flow2go.image.structure.v2"}',
    )
    const submit = draft.nodes.find((n) => n.id === 'n-submit')
    const review = draft.nodes.find((n) => n.id === 'n-review')
    const approveGroup = draft.groups.find((g) => g.id === 'g-approve')
    expect(draft.sceneHint).toBe('swimlane')
    expect(submit?.parentId).toBe('g-approve')
    expect(submit?.lane).toBe('市场专员')
    expect(approveGroup?.style?.fill).toBe('#FFB100')
    expect(review?.style?.fill).toBe('#AABBCC')
  })

  it('preserves groups and nested node styles in free-layout draft', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '预算审批',
      sceneHint: 'swimlane',
      lanes: ['市场专员'],
      groups: [
        { id: 'lane-1', label: '市场专员', kind: 'lane', x: 0.04, y: 0.06, w: 0.92, h: 0.36, style: { fill: '#F6F8FA' } },
        { id: 'g-1', label: '审批区', kind: 'group', parentId: 'lane-1', x: 0.1, y: 0.12, w: 0.32, h: 0.2, style: { fill: '#FFEFCC' } },
      ],
      nodes: [
        {
          id: 'n-1',
          label: '提交',
          type: 'process',
          lane: '市场专员',
          parentId: 'g-1',
          x: 0.14,
          y: 0.18,
          w: 0.1,
          h: 0.06,
          style: { fill: '#D1FAE5', stroke: '#10B981', textColor: '#064E3B' },
        },
      ],
      edges: [],
      rawText: '{}',
    })

    const draft = buildFreeLayoutDraftFromImageStructured(refined)
    const lane = (draft.nodes as any[]).find((n) => n.id === 'lane-1')
    const group = (draft.nodes as any[]).find((n) => n.id === 'g-1')
    const child = (draft.nodes as any[]).find((n) => n.id === 'n-1')

    expect(lane?.type).toBe('group')
    expect(group?.type).toBe('group')
    expect(child?.parentId).toBe('g-1')
    expect((child?.position?.x ?? -1) >= 0).toBe(true)
    expect((child?.position?.y ?? -1) >= 0).toBe(true)
    expect(child?.data?.color).toBe('#D1FAE5')
    expect(child?.data?.stroke).toBe('#10B981')
  })

  it('keeps relative lane spacing hints for swimlane image draft', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '泳道识图',
      sceneHint: 'swimlane',
      lanes: ['用户'],
      groups: [{ id: 'lane-user', label: '用户', kind: 'lane', x: 0.04, y: 0.1, w: 0.92, h: 0.32 }],
      nodes: [
        { id: 'n1', label: '开始', type: 'start_end', lane: '用户', x: 0.10, y: 0.20, w: 0.10, h: 0.08 },
        { id: 'n2', label: '提交', type: 'process', lane: '用户', x: 0.26, y: 0.20, w: 0.10, h: 0.08 },
        { id: 'n3', label: '结束', type: 'start_end', lane: '用户', x: 0.68, y: 0.20, w: 0.10, h: 0.08 },
      ],
      edges: [
        { from: 'n1', to: 'n2', relation: 'next' },
        { from: 'n2', to: 'n3', relation: 'next' },
      ],
      rawText: '{}',
    })

    const swimlane = buildSwimlaneDraftFromImageStructured(refined)
    const cols = swimlane.nodes
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((n) => n.laneCol ?? 0)

    expect(cols.length).toBe(3)
    expect(cols[1] - cols[0]).toBeGreaterThanOrEqual(1)
    expect(cols[2] - cols[1]).toBeGreaterThan(cols[1] - cols[0])
  })

  it('preserves swimlane node geometry when using swimlane scene', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '泳道保真',
      sceneHint: 'swimlane',
      lanes: ['用户'],
      groups: [{ id: 'lane-user', label: '用户', kind: 'lane', x: 0.05, y: 0.1, w: 0.9, h: 0.3 }],
      nodes: [
        { id: 'a', label: 'A', type: 'process', lane: '用户', parentId: 'lane-user', x: 0.10, y: 0.20, w: 0.1, h: 0.08 },
        { id: 'b', label: 'B', type: 'process', lane: '用户', parentId: 'lane-user', x: 0.40, y: 0.22, w: 0.1, h: 0.08 },
      ],
      edges: [{ from: 'a', to: 'b', relation: 'next' }],
      rawText: '{}',
    })

    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(refined)
    const a = (draft.nodes as any[]).find((n) => n.id === 'a')
    const b = (draft.nodes as any[]).find((n) => n.id === 'b')
    expect(a?.parentId).toBe('lane-user')
    expect(b?.parentId).toBe('lane-user')
    expect((b?.position?.x ?? 0) - (a?.position?.x ?? 0)).toBeGreaterThanOrEqual(200)
  })

  it('auto infers swimlane bands when recognition misses lane groups', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '泳道缺失自动补',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [],
      nodes: [
        { id: 'u1', label: '用户发起', type: 'process', x: 0.10, y: 0.16, w: 0.1, h: 0.08 },
        { id: 'u2', label: '用户确认', type: 'process', x: 0.38, y: 0.18, w: 0.1, h: 0.08 },
        { id: 's1', label: '系统校验', type: 'process', x: 0.14, y: 0.56, w: 0.1, h: 0.08 },
        { id: 's2', label: '系统通知', type: 'process', x: 0.42, y: 0.58, w: 0.1, h: 0.08 },
      ],
      edges: [
        { from: 'u1', to: 'u2', relation: 'next' },
        { from: 'u2', to: 's1', relation: 'next' },
        { from: 's1', to: 's2', relation: 'next' },
      ],
      rawText: '{}',
    })

    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(refined)
    const laneGroups = (draft.nodes as any[]).filter((n) => n.type === 'group' && n?.data?.role === 'lane')
    const u1 = (draft.nodes as any[]).find((n) => n.id === 'u1')
    const s1 = (draft.nodes as any[]).find((n) => n.id === 's1')

    expect(laneGroups.length).toBeGreaterThanOrEqual(2)
    expect(Boolean(u1?.parentId)).toBe(true)
    expect(Boolean(s1?.parentId)).toBe(true)
    expect(u1?.parentId).not.toBe(s1?.parentId)
  })

  it('auto infers column swimlane direction from node geometry when lane groups are missing', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '无泳道框时自动识别列泳道',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [],
      nodes: [
        { id: 'l1', label: '用户发起', type: 'process', x: 0.14, y: 0.16, w: 0.11, h: 0.08 },
        { id: 'l2', label: '用户确认', type: 'process', x: 0.16, y: 0.52, w: 0.11, h: 0.08 },
        { id: 'r1', label: '系统处理', type: 'process', x: 0.58, y: 0.20, w: 0.11, h: 0.08 },
        { id: 'r2', label: '系统通知', type: 'process', x: 0.60, y: 0.56, w: 0.11, h: 0.08 },
      ],
      edges: [
        { from: 'l1', to: 'r1', relation: 'next' },
        { from: 'l2', to: 'r2', relation: 'next' },
      ],
      rawText: '{}',
    })

    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(refined)
    const nodes = draft.nodes as any[]
    const lanes = nodes.filter((n) => n.type === 'group' && n?.data?.role === 'lane')
    expect(lanes.length).toBeGreaterThanOrEqual(2)
    for (const lane of lanes) {
      expect(String(lane?.data?.laneMeta?.laneAxis ?? '')).toBe('column')
      expect(String(lane?.data?.titlePosition ?? '')).toBe('top-center')
    }
  })

  it('roughly normalizes similar node sizes and snaps near-aligned positions', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '对齐修正',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [],
      nodes: [
        { id: 'a', label: '开始', type: 'start_end', x: 0.10, y: 0.220, w: 0.08, h: 0.06 },
        { id: 'b', label: '判断', type: 'decision', x: 0.30, y: 0.224, w: 0.14, h: 0.10 },
        { id: 'c', label: '处理', type: 'process', x: 0.50, y: 0.228, w: 0.11, h: 0.07 },
      ],
      edges: [
        { from: 'a', to: 'b', relation: 'next' },
        { from: 'b', to: 'c', relation: 'next' },
      ],
      rawText: '{}',
    })

    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const nodes = (draft.nodes as any[]).filter((n) => n.type === 'quad')
    const widths = nodes.map((n) => Number(n.width ?? 0))
    const heights = nodes.map((n) => Number(n.height ?? 0))
    const ys = Array.from(new Set(nodes.map((n) => n.position?.y)))
    const widthCount = new Map<number, number>()
    const heightCount = new Map<number, number>()
    for (const w of widths) widthCount.set(w, (widthCount.get(w) ?? 0) + 1)
    for (const h of heights) heightCount.set(h, (heightCount.get(h) ?? 0) + 1)
    const maxWidthCluster = Math.max(...Array.from(widthCount.values()))
    const maxHeightCluster = Math.max(...Array.from(heightCount.values()))

    expect(maxWidthCluster).toBeGreaterThanOrEqual(2)
    expect(maxHeightCluster).toBeGreaterThanOrEqual(2)
    expect(ys.length).toBe(1)
  })

  it('aligns nodes when offset is within one-third node width', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '1/3宽度对齐阈值',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [],
      nodes: [
        { id: 'a', label: 'A', type: 'process', x: 0.12, y: 0.18, w: 0.12, h: 0.08 },
        { id: 'b', label: 'B', type: 'process', x: 0.34, y: 0.24, w: 0.12, h: 0.08 },
        { id: 'c', label: 'C', type: 'process', x: 0.56, y: 0.19, w: 0.12, h: 0.08 },
      ],
      edges: [
        { from: 'a', to: 'b', relation: 'next' },
        { from: 'b', to: 'c', relation: 'next' },
      ],
      rawText: '{}',
    })

    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const nodes = (draft.nodes as any[])
      .filter((n) => n.type === 'quad')
      .sort((n1, n2) => (n1.position?.x ?? 0) - (n2.position?.x ?? 0))
    const ys = Array.from(new Set(nodes.map((n) => n.position?.y ?? 0)))
    expect(ys.length).toBe(1)
  })

  it('avoids overlap while keeping obvious outlier node near original absolute position', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '防重叠+跳脱保留',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [],
      nodes: [
        { id: 'a', label: 'A', type: 'process', x: 0.10, y: 0.20, w: 0.12, h: 0.08 },
        { id: 'b', label: 'B', type: 'process', x: 0.11, y: 0.21, w: 0.12, h: 0.08 },
        { id: 'c', label: 'C', type: 'process', x: 0.28, y: 0.20, w: 0.12, h: 0.08 },
        { id: 'd', label: 'D', type: 'process', x: 0.82, y: 0.72, w: 0.12, h: 0.08 },
      ],
      edges: [],
      rawText: '{}',
    })

    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const nodes = draft.nodes as any[]
    const a = nodes.find((n) => n.id === 'a')
    const b = nodes.find((n) => n.id === 'b')
    const d = nodes.find((n) => n.id === 'd')
    const aRight = (a?.position?.x ?? 0) + (a?.width ?? 0)
    const bRight = (b?.position?.x ?? 0) + (b?.width ?? 0)
    const ax = a?.position?.x ?? 0
    const ay = a?.position?.y ?? 0
    const bx = b?.position?.x ?? 0
    const by = b?.position?.y ?? 0
    const overlap = ax < bRight && aRight > bx && ay < by + (b?.height ?? 0) && ay + (a?.height ?? 0) > by
    expect(overlap).toBe(false)

    const expectedDx = Math.round((0.82 * 1800) / GRID_UNIT) * GRID_UNIT
    const expectedDy = Math.round((0.72 * 1000) / GRID_UNIT) * GRID_UNIT
    expect(Math.abs((d?.position?.x ?? 0) - expectedDx)).toBeLessThanOrEqual(GRID_UNIT * 2)
    expect(Math.abs((d?.position?.y ?? 0) - expectedDy)).toBeLessThanOrEqual(GRID_UNIT * 2)
  })

  it('does not force horizontal alignment for only two nodes', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '横向弱约束',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [],
      nodes: [
        { id: 'a', label: 'A', type: 'process', x: 0.22, y: 0.30, w: 0.12, h: 0.08 },
        { id: 'b', label: 'B', type: 'process', x: 0.26, y: 0.30, w: 0.12, h: 0.08 },
      ],
      edges: [{ from: 'a', to: 'b', relation: 'next' }],
      rawText: '{}',
    })

    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const nodes = (draft.nodes as any[])
      .filter((n) => n.type === 'quad')
      .sort((n1, n2) => (n1.id > n2.id ? 1 : -1))
    expect(nodes.length).toBe(2)
    expect(nodes[0].position?.x).not.toBe(nodes[1].position?.x)
  })

  it('recursively regularizes grouped structure with fixed container padding and approximate equal widths', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '包含结构递归规整',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [
        { id: 'g-root', label: 'root', kind: 'group', x: 0.08, y: 0.08, w: 0.84, h: 0.72 },
        { id: 'g-a', label: 'A层', kind: 'group', parentId: 'g-root', x: 0.12, y: 0.16, w: 0.76, h: 0.24 },
        { id: 'g-b', label: 'B层', kind: 'group', parentId: 'g-root', x: 0.12, y: 0.46, w: 0.76, h: 0.24 },
      ],
      nodes: [
        { id: 'a1', label: 'a1', type: 'process', parentId: 'g-a', x: 0.18, y: 0.20, w: 0.14, h: 0.08 },
        { id: 'a2', label: 'a2', type: 'process', parentId: 'g-a', x: 0.38, y: 0.205, w: 0.12, h: 0.08 },
        { id: 'a3', label: 'a3', type: 'process', parentId: 'g-a', x: 0.58, y: 0.21, w: 0.13, h: 0.08 },
        { id: 'b1', label: 'b1', type: 'process', parentId: 'g-b', x: 0.18, y: 0.50, w: 0.13, h: 0.08 },
        { id: 'b2', label: 'b2', type: 'process', parentId: 'g-b', x: 0.40, y: 0.495, w: 0.12, h: 0.08 },
        { id: 'b3', label: 'b3', type: 'process', parentId: 'g-b', x: 0.60, y: 0.51, w: 0.12, h: 0.08 },
      ],
      edges: [],
      rawText: '{}',
    })

    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const nodes = draft.nodes as any[]
    const gA = nodes.find((n) => n.id === 'g-a')
    const gB = nodes.find((n) => n.id === 'g-b')
    const rowA = nodes.filter((n) => n.parentId === 'g-a' && n.type === 'quad')
    const rowB = nodes.filter((n) => n.parentId === 'g-b' && n.type === 'quad')
    expect(rowA.length).toBe(3)
    expect(rowB.length).toBe(3)

    const widthsA = rowA.map((n) => Number(n.width ?? 0))
    const widthsB = rowB.map((n) => Number(n.width ?? 0))
    expect(Math.max(...widthsA) - Math.min(...widthsA)).toBeLessThanOrEqual(GRID_UNIT * 2)
    expect(Math.max(...widthsB) - Math.min(...widthsB)).toBeLessThanOrEqual(GRID_UNIT * 2)

    const pad = GRID_UNIT
    const minXA = Math.min(...rowA.map((n) => Number(n.position?.x) || 0))
    const minXB = Math.min(...rowB.map((n) => Number(n.position?.x) || 0))
    expect(minXA).toBe(pad)
    expect(minXB).toBe(pad)
    expect(Number(gA?.width ?? 0)).toBeGreaterThan(0)
    expect(Number(gB?.width ?? 0)).toBeGreaterThan(0)
  })

  it('packs mixed huarongdao-like group without overlap and uses half-unit recursive spacing baseline', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '华容道混排平铺',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [
        { id: 'g-main', label: '主分层', kind: 'group', x: 0.08, y: 0.10, w: 0.80, h: 0.62 },
      ],
      nodes: [
        { id: 'n1', label: 'n1', type: 'process', parentId: 'g-main', x: 0.16, y: 0.20, w: 0.20, h: 0.10 },
        { id: 'n2', label: 'n2', type: 'process', parentId: 'g-main', x: 0.30, y: 0.20, w: 0.12, h: 0.10 },
        { id: 'n3', label: 'n3', type: 'process', parentId: 'g-main', x: 0.46, y: 0.20, w: 0.12, h: 0.10 },
        { id: 'n4', label: 'n4', type: 'process', parentId: 'g-main', x: 0.16, y: 0.34, w: 0.12, h: 0.10 },
        { id: 'n5', label: 'n5', type: 'process', parentId: 'g-main', x: 0.30, y: 0.34, w: 0.20, h: 0.10 },
        { id: 'n6', label: 'n6', type: 'process', parentId: 'g-main', x: 0.54, y: 0.34, w: 0.12, h: 0.10 },
      ],
      edges: [],
      rawText: '{}',
    })

    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const allNodes = draft.nodes as any[]
    const children = allNodes.filter((n) => n.type === 'quad' && n.parentId === 'g-main')
    expect(children.length).toBe(6)

    const minX = Math.min(...children.map((n) => Number(n?.position?.x) || 0))
    const minY = Math.min(...children.map((n) => Number(n?.position?.y) || 0))
    expect(minX).toBe(GRID_UNIT)
    expect(minY).toBe(GRID_UNIT)

    const overlap = (() => {
      for (let i = 0; i < children.length; i += 1) {
        for (let j = i + 1; j < children.length; j += 1) {
          const a = children[i]
          const b = children[j]
          const ax = Number(a?.position?.x) || 0
          const ay = Number(a?.position?.y) || 0
          const aw = Math.max(GRID_UNIT, Number(a?.width ?? a?.style?.width ?? GRID_UNIT))
          const ah = Math.max(GRID_UNIT, Number(a?.height ?? a?.style?.height ?? GRID_UNIT))
          const bx = Number(b?.position?.x) || 0
          const by = Number(b?.position?.y) || 0
          const bw = Math.max(GRID_UNIT, Number(b?.width ?? b?.style?.width ?? GRID_UNIT))
          const bh = Math.max(GRID_UNIT, Number(b?.height ?? b?.style?.height ?? GRID_UNIT))
          if (ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by) return true
        }
      }
      return false
    })()
    expect(overlap).toBe(false)
  })

  it('falls back to white text on dark fills when model text color is missing', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '字色纠偏',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [],
      nodes: [
        { id: 'n1', label: '深色块', type: 'process', x: 0.12, y: 0.2, w: 0.2, h: 0.1, style: { fill: '#0F172A' } },
      ],
      edges: [],
      rawText: '{}',
    })
    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const node = (draft.nodes as any[]).find((n) => n.id === 'n1')
    expect(node?.data?.labelColor).toBe('#FFFFFF')
    expect(node?.data?.fontColor).toBe('#FFFFFF')
  })

  it('keeps model-recognized decision text color instead of forcing white', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '菱形字色保留',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [],
      nodes: [
        {
          id: 'd1',
          label: '是否通过',
          type: 'decision',
          x: 0.22,
          y: 0.22,
          w: 0.12,
          h: 0.10,
          style: { fill: '#FFB100', textColor: '#111111', stroke: '#E5A000' },
        },
      ],
      edges: [],
      rawText: '{}',
    })
    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const node = (draft.nodes as any[]).find((n) => n.id === 'd1')
    expect(node?.data?.shape).toBe('diamond')
    expect(node?.data?.labelColor).toBe('#111111')
    expect(node?.data?.fontColor).toBe('#111111')
  })

  it('applies monochrome image theme with neutral default frame/node colors', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '黑白图语义描边',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [{ id: 'g1', label: '分组', kind: 'group', x: 0.04, y: 0.08, w: 0.92, h: 0.42 }],
      nodes: [
        { id: 's', label: '开始', type: 'start_end', parentId: 'g1', x: 0.08, y: 0.2, w: 0.12, h: 0.08, style: { fill: '#FFFFFF', stroke: '#999999' } },
        { id: 'd', label: '判断', type: 'decision', parentId: 'g1', x: 0.36, y: 0.2, w: 0.12, h: 0.08, style: { fill: '#EFEFEF', stroke: '#666666' } },
        { id: 't', label: '处理', type: 'process', parentId: 'g1', x: 0.64, y: 0.2, w: 0.12, h: 0.08, style: { fill: '#F5F5F5', stroke: '#777777' } },
      ],
      edges: [
        { from: 's', to: 'd', relation: 'next' },
        { from: 'd', to: 't', relation: 'yes' },
      ],
      rawText: '{}',
    })
    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const g1 = (draft.nodes as any[]).find((n) => n.id === 'g1')
    const s = (draft.nodes as any[]).find((n) => n.id === 's')
    const d = (draft.nodes as any[]).find((n) => n.id === 'd')
    const t = (draft.nodes as any[]).find((n) => n.id === 't')
    expect(g1?.data?.fill).toBe('rgba(226, 232, 240, 0.14)')
    expect(g1?.data?.stroke).toBe('#CBD5E1')
    expect(g1?.data?.strokeWidth).toBe(1)
    expect(s?.data?.color).toBe('#FFFFFF')
    expect(d?.data?.color).toBe('#FFFFFF')
    expect(t?.data?.color).toBe('#FFFFFF')
    expect(s?.data?.strokeWidth).toBe(1)
    expect(d?.data?.strokeWidth).toBe(1)
    expect(t?.data?.strokeWidth).toBe(1)
    expect(s?.data?.stroke).toBe('#E2E8F0')
    expect(d?.data?.stroke).toBe('#E2E8F0')
    expect(t?.data?.stroke).toBe('#E2E8F0')
  })

  it('preserves white text on dark fill by disabling monochrome collapse when contrast is explicit', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '白字深底保留',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [],
      nodes: [
        { id: 'n1', label: '核心节点', type: 'process', x: 0.18, y: 0.22, w: 0.16, h: 0.10, style: { fill: '#111111', textColor: '#FFFFFF', stroke: '#444444' } },
        { id: 'n2', label: '普通节点', type: 'process', x: 0.48, y: 0.22, w: 0.16, h: 0.10, style: { fill: '#F7F7F7', textColor: '#111111', stroke: '#AAAAAA' } },
      ],
      edges: [{ from: 'n1', to: 'n2', relation: 'next' }],
      rawText: '{}',
    })

    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const n1 = (draft.nodes as any[]).find((n) => n.id === 'n1')
    expect(n1?.data?.color).toBe('#111111')
    expect(n1?.data?.fontColor).toBe('#FFFFFF')
  })

  it('auto-fixes swimlane spacing and title-safe area in preserve mode, and removes frame wrappers', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '泳道排版自动修复',
      sceneHint: 'swimlane',
      lanes: ['用户', '系统'],
      groups: [
        { id: 'frame-1', label: '总流程', kind: 'group', x: 0.10, y: 0.10, w: 0.78, h: 0.72 },
        { id: 'lane-1', label: '用户', kind: 'lane', parentId: 'frame-1', x: 0.14, y: 0.16, w: 0.60, h: 0.20 },
        { id: 'lane-2', label: '系统', kind: 'lane', parentId: 'frame-1', x: 0.18, y: 0.46, w: 0.56, h: 0.20 },
      ],
      nodes: [
        { id: 'n-1', label: '提交', type: 'process', lane: '用户', parentId: 'lane-1', x: 0.145, y: 0.21, w: 0.10, h: 0.08 },
        { id: 'n-2', label: '处理', type: 'process', lane: '系统', parentId: 'lane-2', x: 0.185, y: 0.51, w: 0.10, h: 0.08 },
      ],
      edges: [{ from: 'n-1', to: 'n-2', relation: 'next' }],
      rawText: '{}',
    })

    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(refined)
    const nodes = (draft.nodes as any[]).filter(Boolean)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const getSize = (node: any) => ({
      w: Number(node?.width ?? node?.style?.width ?? GRID_UNIT),
      h: Number(node?.height ?? node?.style?.height ?? GRID_UNIT),
    })
    const getAbsPos = (node: any) => {
      let x = Number(node?.position?.x) || 0
      let y = Number(node?.position?.y) || 0
      let cur = node
      const seen = new Set<string>()
      while (cur?.parentId && !seen.has(cur.id)) {
        seen.add(cur.id)
        const parent = byId.get(cur.parentId)
        if (!parent) break
        x += Number(parent?.position?.x) || 0
        y += Number(parent?.position?.y) || 0
        cur = parent
      }
      return { x, y }
    }

    const lanes = nodes
      .filter((n) => n.type === 'group' && n?.data?.role === 'lane')
      .sort((a, b) => getAbsPos(a).y - getAbsPos(b).y)
    expect(lanes.length).toBe(2)

    for (const lane of lanes) {
      const laneChildren = nodes.filter((n) => n.parentId === lane.id && n.type === 'quad')
      expect(laneChildren.length).toBeGreaterThan(0)
      const minChildX = Math.min(...laneChildren.map((n) => Number(n?.position?.x) || 0))
      expect(minChildX).toBeGreaterThanOrEqual(48 + GRID_UNIT * 2)
    }

    const lane1Abs = getAbsPos(lanes[0])
    const lane1Size = getSize(lanes[0])
    const lane2Abs = getAbsPos(lanes[1])
    const laneGap = lane2Abs.y - (lane1Abs.y + lane1Size.h)
    expect(laneGap).toBe(GRID_UNIT)

    const frames = nodes.filter((n) => n.type === 'group' && n?.data?.role === 'frame')
    expect(frames.length).toBe(0)
  })

  it('uses top-centered lane headers for column swimlanes and keeps header-safe top padding', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '列泳道标题位置',
      sceneHint: 'swimlane',
      lanes: ['用户', '系统'],
      groups: [
        { id: 'lane-1', label: '用户', kind: 'lane', x: 0.08, y: 0.10, w: 0.36, h: 0.70 },
        { id: 'lane-2', label: '系统', kind: 'lane', x: 0.52, y: 0.10, w: 0.36, h: 0.70 },
      ],
      nodes: [
        { id: 'n-1', label: '发起', type: 'process', lane: '用户', parentId: 'lane-1', x: 0.17, y: 0.12, w: 0.12, h: 0.08 },
        { id: 'n-2', label: '处理', type: 'process', lane: '系统', parentId: 'lane-2', x: 0.61, y: 0.12, w: 0.12, h: 0.08 },
      ],
      edges: [{ from: 'n-1', to: 'n-2', relation: 'next' }],
      rawText: '{}',
    })

    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(refined)
    const nodes = draft.nodes as any[]
    const lanes = nodes
      .filter((n) => n.type === 'group' && n?.data?.role === 'lane')
      .sort((a, b) => (Number(a?.position?.x) || 0) - (Number(b?.position?.x) || 0))
    expect(lanes.length).toBe(2)

    for (const lane of lanes) {
      expect(String(lane?.data?.titlePosition ?? '')).toBe('top-center')
      expect(String(lane?.data?.laneMeta?.laneAxis ?? '')).toBe('column')
      const laneChildren = nodes.filter((n) => n.type === 'quad' && n.parentId === lane.id)
      expect(laneChildren.length).toBeGreaterThan(0)
      const minChildY = Math.min(...laneChildren.map((n) => Number(n?.position?.y) || 0))
      expect(minChildY).toBeGreaterThanOrEqual(48 + GRID_UNIT)
      const laneWidth = Number(lane?.width ?? lane?.style?.width ?? 0)
      const laneCenter = laneWidth * 0.5
      for (const child of laneChildren) {
        const childX = Number(child?.position?.x) || 0
        const childW = Number(child?.width ?? child?.style?.width ?? GRID_UNIT * 10)
        const childCenter = childX + childW * 0.5
        expect(Math.abs(childCenter - laneCenter)).toBeLessThanOrEqual(GRID_UNIT * 2)
      }
    }
  })

  it('cross-lane micro-aligns near columns after lane absorption in preserve mode', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '跨泳道近似对齐（absorb 后生效）',
      sceneHint: 'swimlane',
      lanes: ['用户', '系统'],
      groups: [
        { id: 'lane-1', label: '用户', kind: 'lane', x: 0.08, y: 0.10, w: 0.84, h: 0.22 },
        { id: 'lane-2', label: '系统', kind: 'lane', x: 0.08, y: 0.42, w: 0.84, h: 0.22 },
      ],
      nodes: [
        // 刻意不提供 parentId，让 absorbSwimlaneNodes 通过几何重算 lane 归属
        { id: 'u1', label: '用户步骤', type: 'process', lane: '用户', x: 0.22, y: 0.16, w: 0.12, h: 0.08 },
        // 与 u1 的 x 很接近但略有偏差，应在 absorb 后跨泳道吸附到同一列中心线
        { id: 's1', label: '系统步骤', type: 'process', lane: '系统', x: 0.235, y: 0.48, w: 0.12, h: 0.08 },
      ],
      edges: [{ from: 'u1', to: 's1', relation: 'next' }],
      rawText: '{}',
    })

    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(refined)
    const nodes = (draft.nodes as any[]).filter(Boolean)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const laneNodes = nodes.filter((n) => n.type === 'group' && n?.data?.role === 'lane')
    expect(laneNodes.length).toBe(2)

    const absPos = (node: any) => {
      let x = Number(node?.position?.x) || 0
      let y = Number(node?.position?.y) || 0
      let cur = node
      const seen = new Set<string>()
      while (cur?.parentId && !seen.has(cur.id)) {
        seen.add(cur.id)
        const p = byId.get(cur.parentId)
        if (!p) break
        x += Number(p?.position?.x) || 0
        y += Number(p?.position?.y) || 0
        cur = p
      }
      return { x, y }
    }

    const u1 = byId.get('u1')
    const s1 = byId.get('s1')
    expect(u1?.parentId).toBe('lane-1')
    expect(s1?.parentId).toBe('lane-2')

    const u1Abs = absPos(u1)
    const s1Abs = absPos(s1)
    const u1CenterX = u1Abs.x + (Number(u1?.width ?? u1?.style?.width ?? 0) || 0) * 0.5
    const s1CenterX = s1Abs.x + (Number(s1?.width ?? s1?.style?.width ?? 0) || 0) * 0.5
    expect(Math.abs(u1CenterX - s1CenterX)).toBeLessThanOrEqual(GRID_UNIT)
  })

  it('quickly prunes extra decision yes/no edges in preserve swimlane mode', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '决策分支走线复查',
      sceneHint: 'swimlane',
      lanes: ['用户', '系统'],
      groups: [
        { id: 'lane-1', label: '用户', kind: 'lane', x: 0.08, y: 0.10, w: 0.84, h: 0.22 },
        { id: 'lane-2', label: '系统', kind: 'lane', x: 0.08, y: 0.42, w: 0.84, h: 0.22 },
      ],
      nodes: [
        { id: 'd1', label: '判断', type: 'decision', lane: '用户', x: 0.18, y: 0.16, w: 0.14, h: 0.10 },
        { id: 't1', label: '分支1', type: 'process', lane: '系统', x: 0.52, y: 0.44, w: 0.12, h: 0.08 },
        { id: 't2', label: '分支2', type: 'process', lane: '系统', x: 0.66, y: 0.50, w: 0.12, h: 0.08 },
        { id: 't3', label: '分支3', type: 'process', lane: '系统', x: 0.76, y: 0.56, w: 0.12, h: 0.08 },
      ],
      edges: [
        { from: 'd1', to: 't1', relation: 'yes' },
        { from: 'd1', to: 't2', relation: 'no' },
        { from: 'd1', to: 't3', relation: 'yes' }, // 多余的 yes/no，应被快速复查移除
      ],
      rawText: '{}',
    })

    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(refined)
    const edges = (draft.edges as any[]).filter((e) => String(e?.source ?? '') === 'd1')
    const yesNo = edges.filter((e) => {
      const rel = String(e?.data?.relation ?? '').toLowerCase()
      return rel === 'yes' || rel === 'no'
    })
    expect(yesNo.length).toBeLessThanOrEqual(2)
  })

  it('removes redundant frame when it duplicates lane title and bounds', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '同名重复画框清理',
      sceneHint: 'swimlane',
      lanes: ['用户', '系统'],
      groups: [
        { id: 'lane-u', label: '用户', kind: 'lane', x: 0.10, y: 0.12, w: 0.76, h: 0.24 },
        { id: 'lane-s', label: '系统', kind: 'lane', x: 0.10, y: 0.44, w: 0.76, h: 0.24 },
        // 识图误检：与泳道同名且高度重叠的 frame
        { id: 'frame-u-dup', label: '用户', kind: 'group', x: 0.11, y: 0.13, w: 0.74, h: 0.22 },
      ],
      nodes: [
        { id: 'n1', label: '提交', type: 'process', lane: '用户', parentId: 'lane-u', x: 0.18, y: 0.20, w: 0.10, h: 0.08 },
        { id: 'n2', label: '处理', type: 'process', lane: '系统', parentId: 'lane-s', x: 0.18, y: 0.52, w: 0.10, h: 0.08 },
      ],
      edges: [{ from: 'n1', to: 'n2', relation: 'next' }],
      rawText: '{}',
    })

    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(refined)
    const nodes = draft.nodes as any[]
    const duplicate = nodes.find((n) => n.id === 'frame-u-dup')
    const userLane = nodes.find((n) => n.id === 'lane-u')
    const userNamedFrames = nodes.filter(
      (n) => n.type === 'group' && n?.data?.role === 'frame' && String(n?.data?.title ?? '').trim() === '用户',
    )

    expect(duplicate).toBeUndefined()
    expect(Boolean(userLane)).toBe(true)
    expect(userNamedFrames.length).toBe(0)
  })

  it('reassigns node to geometric lane even when parent/lane text is wrong', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '泳道归属重算',
      sceneHint: 'swimlane',
      lanes: ['用户', '系统'],
      groups: [
        { id: 'lane-u', label: '用户', kind: 'lane', x: 0.10, y: 0.12, w: 0.78, h: 0.24 },
        { id: 'lane-s', label: '系统', kind: 'lane', x: 0.10, y: 0.44, w: 0.78, h: 0.24 },
      ],
      nodes: [
        // 实际位于“系统”泳道几何区域，但识别 lane 文本与 parentId 错到“用户”
        { id: 'n-x', label: '处理结果', type: 'process', lane: '用户', parentId: 'lane-u', x: 0.28, y: 0.52, w: 0.10, h: 0.08 },
      ],
      edges: [],
      rawText: '{}',
    })

    const draft = buildSwimlanePreserveLayoutDraftFromImageStructured(refined)
    const nodes = draft.nodes as any[]
    const target = nodes.find((n) => n.id === 'n-x')
    expect(Boolean(target)).toBe(true)
    expect(target.parentId).toBe('lane-s')
    expect(String(target?.data?.laneId ?? '')).toBe('lane-s')
  })

  it('recursively regularizes alignment and spacing within nested groups', () => {
    const refined = refineImageStructuredDraft({
      schema: 'flow2go.image.structure.v2',
      title: '递归规整',
      sceneHint: 'flowchart',
      lanes: [],
      groups: [
        { id: 'g-outer', label: '外层', kind: 'group', x: 0.08, y: 0.08, w: 0.82, h: 0.76 },
        { id: 'g-inner', label: '内层', kind: 'group', parentId: 'g-outer', x: 0.16, y: 0.22, w: 0.66, h: 0.44 },
      ],
      nodes: [
        { id: 'a', label: 'A', type: 'process', parentId: 'g-inner', x: 0.24, y: 0.304, w: 0.10, h: 0.08 },
        { id: 'b', label: 'B', type: 'process', parentId: 'g-inner', x: 0.40, y: 0.297, w: 0.10, h: 0.08 },
        { id: 'c', label: 'C', type: 'process', parentId: 'g-inner', x: 0.58, y: 0.312, w: 0.10, h: 0.08 },
      ],
      edges: [
        { from: 'a', to: 'b', relation: 'next' },
        { from: 'b', to: 'c', relation: 'next' },
      ],
      rawText: '{}',
    })

    const draft = buildFreeLayoutDraftFromImageStructured(refined, { preserveLayoutStrict: true })
    const nodes = draft.nodes as any[]
    const innerChildren = nodes
      .filter((n) => n.type === 'quad' && n.parentId === 'g-inner')
      .sort((n1, n2) => (n1.position?.x ?? 0) - (n2.position?.x ?? 0))
    expect(innerChildren.length).toBe(3)

    const ys = Array.from(new Set(innerChildren.map((n) => n.position?.y ?? 0)))
    expect(ys.length).toBe(1)

    const x1 = innerChildren[0].position?.x ?? 0
    const x2 = innerChildren[1].position?.x ?? 0
    const x3 = innerChildren[2].position?.x ?? 0
    const gap1 = x2 - x1
    const gap2 = x3 - x2
    expect(Math.abs(gap1 - gap2)).toBeLessThanOrEqual(GRID_UNIT * 6)
  })
})
