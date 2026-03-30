import { describe, expect, it } from 'vitest'
import { autoLayoutSwimlane } from '../swimlaneLayout'

describe('swimlane layout column span', () => {
  it('merges adjacent rows when column sets are disjoint (approximate same row)', () => {
    const lane: any = {
      id: 'lane-a',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'row' } },
      width: 960,
      height: 220,
    }
    const top: any = {
      id: 'top',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 0, laneCol: 0, nodeOrder: 0 },
      width: 160,
      height: 48,
    }
    const bottomOtherCol: any = {
      id: 'bottom',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 1, laneCol: 1, nodeOrder: 1 },
      width: 160,
      height: 48,
    }

    const laid = autoLayoutSwimlane({
      nodes: [lane, top, bottomOtherCol],
      edges: [],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })
    const a = laid.nodes.find((n) => n.id === 'top')!
    const b = laid.nodes.find((n) => n.id === 'bottom')!
    expect(Math.abs((a.position?.y ?? 0) - (b.position?.y ?? 0))).toBeLessThan(1e-6)
  })

  it('separates nodes that wrongly share the same laneCol on one row (no overlap)', () => {
    const lane: any = {
      id: 'lane-a',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'row' } },
      width: 960,
      height: 220,
    }
    const n1: any = {
      id: 'n1',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 0, laneCol: 1, nodeOrder: 0 },
      width: 160,
      height: 48,
    }
    const n2: any = {
      id: 'n2',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 0, laneCol: 1, nodeOrder: 1 },
      width: 160,
      height: 48,
    }

    const laid = autoLayoutSwimlane({
      nodes: [lane, n1, n2],
      edges: [],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })
    const a = laid.nodes.find((n) => n.id === 'n1')!
    const b = laid.nodes.find((n) => n.id === 'n2')!
    expect(Math.abs((b.position?.x ?? 0) - (a.position?.x ?? 0))).toBeGreaterThan(1)
  })

  it('keeps larger visual gap for skipped laneCol values', () => {
    const lane: any = {
      id: 'lane-a',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'row' } },
      width: 960,
      height: 220,
    }
    const nodeA: any = {
      id: 'a',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 0, laneCol: 0, nodeOrder: 0 },
      width: 160,
      height: 48,
    }
    const nodeB: any = {
      id: 'b',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 0, laneCol: 1, nodeOrder: 1 },
      width: 160,
      height: 48,
    }
    const nodeC: any = {
      id: 'c',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 0, laneCol: 3, nodeOrder: 2 },
      width: 160,
      height: 48,
    }

    const laid = autoLayoutSwimlane({
      nodes: [lane, nodeA, nodeB, nodeC],
      edges: [],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })

    const a = laid.nodes.find((n) => n.id === 'a')!
    const b = laid.nodes.find((n) => n.id === 'b')!
    const c = laid.nodes.find((n) => n.id === 'c')!
    const d1 = (b.position?.x ?? 0) - (a.position?.x ?? 0)
    const d2 = (c.position?.x ?? 0) - (b.position?.x ?? 0)

    expect(d1).toBeGreaterThan(0)
    expect(d2).toBeGreaterThan(d1)
    expect(d2 - d1).toBeGreaterThanOrEqual(32)
  })

  it('aligns the same laneRow across column swimlanes (vertical direction)', () => {
    const laneA: any = {
      id: 'lane-a',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'column' } },
      width: 960,
      height: 400,
    }
    const laneB: any = {
      id: 'lane-b',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 1, laneAxis: 'column' } },
      width: 960,
      height: 400,
    }
    const n1: any = {
      id: 'n1',
      type: 'quad',
      parentId: laneA.id,
      position: { x: 0, y: 0 },
      data: { laneId: laneA.id, laneRow: 0, laneCol: 0, nodeOrder: 0 },
      width: 160,
      height: 48,
    }
    const n2: any = {
      id: 'n2',
      type: 'quad',
      parentId: laneB.id,
      position: { x: 0, y: 0 },
      data: { laneId: laneB.id, laneRow: 0, laneCol: 0, nodeOrder: 0 },
      width: 160,
      height: 48,
    }

    const laid = autoLayoutSwimlane({
      nodes: [laneA, laneB, n1, n2],
      edges: [],
      direction: 'LR',
      swimlaneDirection: 'vertical',
    })
    const a = laid.nodes.find((n) => n.id === 'n1')!
    const b = laid.nodes.find((n) => n.id === 'n2')!
    const absA = (n: any) => ({
      x: (laid.nodes.find((x) => x.id === n.parentId)?.position?.x ?? 0) + (n.position?.x ?? 0),
      y: (laid.nodes.find((x) => x.id === n.parentId)?.position?.y ?? 0) + (n.position?.y ?? 0),
    })
    expect(Math.abs(absA(a).y - absA(b).y)).toBeLessThan(1e-6)
  })

  it('aligns the same laneCol across lanes using global column widths', () => {
    const laneA: any = {
      id: 'lane-a',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'row' } },
      width: 960,
      height: 220,
    }
    const laneB: any = {
      id: 'lane-b',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 1, laneAxis: 'row' } },
      width: 960,
      height: 220,
    }
    const wide: any = {
      id: 'wide',
      type: 'quad',
      parentId: laneA.id,
      position: { x: 0, y: 0 },
      data: { laneId: laneA.id, laneRow: 0, laneCol: 0, nodeOrder: 0 },
      width: 200,
      height: 48,
    }
    const narrow: any = {
      id: 'narrow',
      type: 'quad',
      parentId: laneB.id,
      position: { x: 0, y: 0 },
      data: { laneId: laneB.id, laneRow: 0, laneCol: 0, nodeOrder: 0 },
      width: 120,
      height: 48,
    }

    const laid = autoLayoutSwimlane({
      nodes: [laneA, laneB, wide, narrow],
      edges: [],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })

    const wNode = laid.nodes.find((n) => n.id === 'wide')!
    const nNode = laid.nodes.find((n) => n.id === 'narrow')!
    const cw = (wNode.width as number) ?? 200
    const nw = (nNode.width as number) ?? 120
    const cxW = (wNode.position?.x ?? 0) + cw / 2
    const cxN = (nNode.position?.x ?? 0) + nw / 2
    expect(Math.abs(cxW - cxN)).toBeLessThan(1e-6)
  })

  it('aligns the same laneRow across lanes using global row heights', () => {
    const laneA: any = {
      id: 'lane-a',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'row' } },
      width: 960,
      height: 220,
    }
    const laneB: any = {
      id: 'lane-b',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 1, laneAxis: 'row' } },
      width: 960,
      height: 220,
    }
    const tall: any = {
      id: 'tall',
      type: 'quad',
      parentId: laneA.id,
      position: { x: 0, y: 0 },
      data: { laneId: laneA.id, laneRow: 0, laneCol: 0, nodeOrder: 0 },
      width: 160,
      height: 72,
    }
    const short: any = {
      id: 'short',
      type: 'quad',
      parentId: laneB.id,
      position: { x: 0, y: 0 },
      data: { laneId: laneB.id, laneRow: 0, laneCol: 0, nodeOrder: 0 },
      width: 160,
      height: 40,
    }

    const laid = autoLayoutSwimlane({
      nodes: [laneA, laneB, tall, short],
      edges: [],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })

    const tNode = laid.nodes.find((n) => n.id === 'tall')!
    const sNode = laid.nodes.find((n) => n.id === 'short')!
    const th = (tNode.height as number) ?? 72
    const sh = (sNode.height as number) ?? 40
    const cyT = (tNode.position?.y ?? 0) + th / 2
    const cyS = (sNode.position?.y ?? 0) + sh / 2
    expect(Math.abs(cyT - cyS)).toBeLessThan(1e-6)
  })
})
