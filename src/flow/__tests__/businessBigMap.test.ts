import { describe, it, expect } from 'vitest'
import { computeNodeSizes, CONTAINER_PADDING_SIDE, CHILD_GAP } from '../businessBigMap/sizing'
import { normalizeBigMapLayout } from '../businessBigMap/normalize'
import { validateIR, validateLayout } from '../businessBigMap/validator'
import { materializeBigMapToFlow2Go } from '../businessBigMap/materialize'
import { layoutWithELK } from '../businessBigMap/layout'
import type { BusinessBigMapIR } from '../businessBigMap/types'

const SAMPLE_IR: BusinessBigMapIR = {
  schema: 'flow2go.business-big-map.v1',
  title: '电商平台业务大图',
  nodes: [
    { id: 'trade', title: '交易域', type: 'container', semanticRole: 'domain', order: 0, children: ['order', 'payment'] },
    { id: 'order', title: '订单管理', type: 'node', semanticRole: 'module', order: 0, children: [] },
    { id: 'payment', title: '支付中心', type: 'node', semanticRole: 'module', order: 1, children: [] },
    { id: 'product', title: '商品域', type: 'container', semanticRole: 'domain', order: 1, children: ['sku'] },
    { id: 'sku', title: 'SKU管理', type: 'node', semanticRole: 'feature', order: 0, children: [] },
  ],
}

describe('BusinessBigMap IR Validation', () => {
  it('validates a correct IR without issues', () => {
    const { ir, issues } = validateIR(SAMPLE_IR)
    expect(ir.nodes).toHaveLength(5)
    const errors = issues.filter((i) => i.severity === 'error')
    expect(errors).toHaveLength(0)
  })

  it('fixes duplicate ids', () => {
    const bad: BusinessBigMapIR = {
      ...SAMPLE_IR,
      nodes: [
        ...SAMPLE_IR.nodes,
        { id: 'order', title: '重复', type: 'node', semanticRole: 'unknown', order: 99, children: [] },
      ],
    }
    const { issues } = validateIR(bad)
    expect(issues.some((i) => i.message.includes('重复 id'))).toBe(true)
  })

  it('removes invalid children references', () => {
    const bad: BusinessBigMapIR = {
      ...SAMPLE_IR,
      nodes: SAMPLE_IR.nodes.map((n) =>
        n.id === 'trade' ? { ...n, children: ['order', 'payment', 'nonexistent'] } : n,
      ),
    }
    const { ir, issues } = validateIR(bad)
    const tradeNode = ir.nodes.find((n) => n.id === 'trade')!
    expect(tradeNode.children).not.toContain('nonexistent')
    expect(issues.some((i) => i.message.includes('nonexistent'))).toBe(true)
  })

  it('auto-upgrades node with children to container', () => {
    const bad: BusinessBigMapIR = {
      ...SAMPLE_IR,
      nodes: SAMPLE_IR.nodes.map((n) =>
        n.id === 'trade' ? { ...n, type: 'node' as const } : n,
      ),
    }
    const { ir, issues } = validateIR(bad)
    const tradeNode = ir.nodes.find((n) => n.id === 'trade')!
    expect(tradeNode.type).toBe('container')
    expect(issues.some((i) => i.message.includes('自动升级为 container'))).toBe(true)
  })
})

describe('BusinessBigMap Sizing', () => {
  it('computes sizes for all nodes', () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    expect(sized).toHaveLength(5)
    for (const n of sized) {
      expect(n.width).toBeGreaterThan(0)
      expect(n.height).toBeGreaterThan(0)
      expect(n.width % 8).toBe(0)
      expect(n.height % 8).toBe(0)
    }
  })

  it('leaf nodes have compact fixed height', () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const leaf = sized.find((n) => n.id === 'order')!
    expect(leaf.height).toBeGreaterThanOrEqual(48)
  })
})

const MULTI_BAND_IR: BusinessBigMapIR = {
  schema: 'flow2go.business-big-map.v1',
  title: '分层测试',
  nodes: [
    { id: 'trade', title: '交易域', type: 'container', semanticRole: 'domain', order: 0, children: ['order'] },
    { id: 'order', title: '订单', type: 'node', semanticRole: 'module', order: 0, children: [] },
    { id: 'product', title: '商品域', type: 'container', semanticRole: 'domain', order: 1, children: ['sku'] },
    { id: 'sku', title: 'SKU', type: 'node', semanticRole: 'feature', order: 0, children: [] },
    { id: 'user', title: '用户域', type: 'container', semanticRole: 'domain', order: 2, children: [] },
    { id: 'data', title: '数据平台', type: 'container', semanticRole: 'capability', order: 0, children: [] },
    { id: 'tech', title: '技术中台', type: 'container', semanticRole: 'capability', order: 1, children: [] },
  ],
}

describe('BusinessBigMap Band Layout', () => {
  it('assigns positions to all nodes', async () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const result = await layoutWithELK(sized)
    expect(result.nodes).toHaveLength(5)
    expect(result.totalWidth).toBeGreaterThan(0)
    expect(result.totalHeight).toBeGreaterThan(0)
  })

  it('same-role root nodes share the same Y (horizontal band)', async () => {
    const sized = computeNodeSizes(MULTI_BAND_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const trade = byId.get('trade')!
    const product = byId.get('product')!
    const user = byId.get('user')!
    expect(trade.y).toBe(product.y)
    expect(trade.y).toBe(user.y)
  })

  it('different-role root nodes are on different Y bands', async () => {
    const sized = computeNodeSizes(MULTI_BAND_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const domainY = byId.get('trade')!.y
    const capY = byId.get('data')!.y
    expect(capY).toBeGreaterThan(domainY)
  })

  it('same-band nodes have equal height', async () => {
    const sized = computeNodeSizes(MULTI_BAND_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const trade = byId.get('trade')!
    const product = byId.get('product')!
    const user = byId.get('user')!
    expect(trade.height).toBe(product.height)
    expect(trade.height).toBe(user.height)

    const data = byId.get('data')!
    const tech = byId.get('tech')!
    expect(data.height).toBe(tech.height)
  })

  it('domain band appears above capability band (priority ordering)', async () => {
    const sized = computeNodeSizes(MULTI_BAND_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    expect(byId.get('trade')!.y).toBeLessThan(byId.get('data')!.y)
  })

  it('all bands have the same total width (rectangle, no 凸 shape)', async () => {
    const sized = computeNodeSizes(MULTI_BAND_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const domainNodes = ['trade', 'product', 'user'].map((id) => byId.get(id)!)
    const capNodes = ['data', 'tech'].map((id) => byId.get(id)!)

    const domainRight = Math.max(...domainNodes.map((n) => n.x + n.width))
    const capRight = Math.max(...capNodes.map((n) => n.x + n.width))

    expect(domainRight).toBe(capRight)
  })

  it('all bands start at x=0', async () => {
    const sized = computeNodeSizes(MULTI_BAND_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const trade = byId.get('trade')!
    const data = byId.get('data')!
    expect(trade.x).toBe(0)
    expect(data.x).toBe(0)
  })

  it('narrower bands have containers stretched wider than their natural width', async () => {
    const sized = computeNodeSizes(MULTI_BAND_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const tech = byId.get('tech')!
    const bandRight = tech.x + tech.width
    expect(bandRight).toBe(result.totalWidth)
  })
})

describe('BusinessBigMap Compact Fill Layout', () => {
  it('leaf nodes fit within parent container width', async () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const trade = byId.get('trade')!
    const order = byId.get('order')!
    const payment = byId.get('payment')!

    const availW = trade.width - CONTAINER_PADDING_SIDE * 2
    expect(order.width).toBeLessThanOrEqual(availW)
    expect(payment.width).toBeLessThanOrEqual(availW)
    expect(order.x).toBeGreaterThanOrEqual(CONTAINER_PADDING_SIDE)
  })

  it('leaf nodes have uniform width within same container', async () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const order = byId.get('order')!
    const payment = byId.get('payment')!
    expect(order.width).toBe(payment.width)
  })

  it('leaf nodes are spaced with compact gap', async () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const order = byId.get('order')!
    const payment = byId.get('payment')!
    // For single-column: vertical gap; for multi-column same row: check x offset
    if (order.y === payment.y) {
      const gap = payment.x - (order.x + order.width)
      expect(gap).toBeLessThanOrEqual(16)
      expect(gap).toBeGreaterThanOrEqual(0)
    } else {
      const gap = payment.y - (order.y + order.height)
      expect(gap).toBeLessThanOrEqual(16)
      expect(gap).toBeGreaterThanOrEqual(0)
    }
  })

  const NESTED_IR: BusinessBigMapIR = {
    schema: 'flow2go.business-big-map.v1',
    title: '嵌套容器测试',
    nodes: [
      { id: 'pattern', title: 'Pattern (模式)', type: 'container', semanticRole: 'domain', order: 0, children: ['biz', 'flow', 'cap'] },
      { id: 'biz', title: '业务', type: 'container', semanticRole: 'module', order: 0, children: ['id1', 'ext1'] },
      { id: 'id1', title: '业务身份', type: 'node', semanticRole: 'feature', order: 0, children: [] },
      { id: 'ext1', title: '扩展实现', type: 'node', semanticRole: 'feature', order: 1, children: [] },
      { id: 'flow', title: '流程', type: 'container', semanticRole: 'module', order: 1, children: ['f1', 'f2'] },
      { id: 'f1', title: '通用流程', type: 'node', semanticRole: 'feature', order: 0, children: [] },
      { id: 'f2', title: '可变点', type: 'node', semanticRole: 'feature', order: 1, children: [] },
      { id: 'cap', title: '能力', type: 'container', semanticRole: 'module', order: 2, children: ['c1', 'c2'] },
      { id: 'c1', title: '解决方案', type: 'node', semanticRole: 'feature', order: 0, children: [] },
      { id: 'c2', title: '能力组件', type: 'node', semanticRole: 'feature', order: 1, children: [] },
    ],
  }

  it('sibling containers share available width equally', async () => {
    const sized = computeNodeSizes(NESTED_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const flow = byId.get('flow')!
    const cap = byId.get('cap')!
    expect(Math.abs(flow.width - cap.width)).toBeLessThanOrEqual(8)
  })

  it('sibling containers have equal height', async () => {
    const sized = computeNodeSizes(NESTED_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const flow = byId.get('flow')!
    const cap = byId.get('cap')!
    expect(flow.height).toBe(cap.height)
  })

  // 多列网格测试：当容器很宽而叶子很窄时，叶子自动横排
  const WIDE_CONTAINER_IR: BusinessBigMapIR = {
    schema: 'flow2go.business-big-map.v1',
    title: '多列测试',
    nodes: [
      // 3个 domain 容器让层带很宽，但 'narrow' 只有2个子节点（capability 层带只有它一个容器，会被拉伸到全宽）
      { id: 'd1', title: '域1', type: 'container', semanticRole: 'domain', order: 0, children: ['d1a'] },
      { id: 'd1a', title: 'A', type: 'node', semanticRole: 'feature', order: 0, children: [] },
      { id: 'd2', title: '域2', type: 'container', semanticRole: 'domain', order: 1, children: ['d2a'] },
      { id: 'd2a', title: 'B', type: 'node', semanticRole: 'feature', order: 0, children: [] },
      { id: 'd3', title: '域3', type: 'container', semanticRole: 'domain', order: 2, children: ['d3a'] },
      { id: 'd3a', title: 'C', type: 'node', semanticRole: 'feature', order: 0, children: [] },
      // 'wide' 容器在 capability 层带，会被拉伸到与 domain 层带等宽
      { id: 'wide', title: '宽平台', type: 'container', semanticRole: 'capability', order: 0, children: ['w1', 'w2', 'w3', 'w4'] },
      { id: 'w1', title: '能力1', type: 'node', semanticRole: 'feature', order: 0, children: [] },
      { id: 'w2', title: '能力2', type: 'node', semanticRole: 'feature', order: 1, children: [] },
      { id: 'w3', title: '能力3', type: 'node', semanticRole: 'feature', order: 2, children: [] },
      { id: 'w4', title: '能力4', type: 'node', semanticRole: 'feature', order: 3, children: [] },
    ],
  }

  it('uses multi-column layout when container is stretched wide', async () => {
    const sized = computeNodeSizes(WIDE_CONTAINER_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const w1 = byId.get('w1')!
    const w2 = byId.get('w2')!
    // w1 and w2 should be on the same Y (side by side) if the container is wide enough
    // Or at least, w2's x should be > w1's x (not all stacked vertically)
    const wide = byId.get('wide')!
    const availW = wide.width - CONTAINER_PADDING_SIDE * 2
    const leafNatW = w1.width

    if (availW >= 2 * leafNatW + CHILD_GAP) {
      // Multi-column should be active
      expect(w2.x).toBeGreaterThan(w1.x)
      expect(w1.y).toBe(w2.y)
    }
  })

  it('multi-column leaves have uniform width', async () => {
    const sized = computeNodeSizes(WIDE_CONTAINER_IR)
    const result = await layoutWithELK(sized)
    const byId = new Map(result.nodes.map((n) => [n.id, n]))

    const w1 = byId.get('w1')!
    const w2 = byId.get('w2')!
    const w3 = byId.get('w3')!
    const w4 = byId.get('w4')!
    expect(w1.width).toBe(w2.width)
    expect(w2.width).toBe(w3.width)
    expect(w3.width).toBe(w4.width)
  })
})

describe('BusinessBigMap Normalize', () => {
  it('snaps all values to grid', async () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const laid = await layoutWithELK(sized)
    const normalized = normalizeBigMapLayout(laid)
    for (const n of normalized.nodes) {
      expect(n.x % 8).toBe(0)
      expect(n.y % 8).toBe(0)
      expect(n.width % 8).toBe(0)
      expect(n.height % 8).toBe(0)
    }
  })
})

describe('BusinessBigMap Layout Validation', () => {
  it('validates layout and returns issues', async () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const laid = await layoutWithELK(sized)
    const normalized = normalizeBigMapLayout(laid)
    const { layout, issues } = validateLayout(normalized)
    expect(layout.nodes).toHaveLength(5)
    expect(Array.isArray(issues)).toBe(true)
  })
})

describe('BusinessBigMap Materialization', () => {
  it('converts layout to Flow2Go nodes', async () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const laid = await layoutWithELK(sized)
    const normalized = normalizeBigMapLayout(laid)
    const { layout } = validateLayout(normalized)
    const { nodes, edges } = materializeBigMapToFlow2Go(layout)

    expect(nodes).toHaveLength(5)
    expect(edges).toHaveLength(0)

    const groups = nodes.filter((n) => n.type === 'group')
    const quads = nodes.filter((n) => n.type === 'quad')
    expect(groups).toHaveLength(2)
    expect(quads).toHaveLength(3)

    const orderNode = nodes.find((n) => n.id === 'order')!
    expect(orderNode.parentId).toBe('trade')
  })

  it('leaf nodes have transparent fill and no stroke', async () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const laid = await layoutWithELK(sized)
    const normalized = normalizeBigMapLayout(laid)
    const { layout } = validateLayout(normalized)
    const { nodes } = materializeBigMapToFlow2Go(layout)

    const leaf = nodes.find((n) => n.id === 'order')!
    expect((leaf.data as any).fill).toContain('0.12')
    expect((leaf.data as any).strokeWidth).toBe(0)
    expect((leaf.data as any).textColor).toBe('#0f172a')
  })

  it('parent nodes appear before children in output', async () => {
    const sized = computeNodeSizes(SAMPLE_IR)
    const laid = await layoutWithELK(sized)
    const normalized = normalizeBigMapLayout(laid)
    const { layout } = validateLayout(normalized)
    const { nodes } = materializeBigMapToFlow2Go(layout)

    const indexById = new Map(nodes.map((n, i) => [n.id, i]))
    expect(indexById.get('trade')!).toBeLessThan(indexById.get('order')!)
    expect(indexById.get('trade')!).toBeLessThan(indexById.get('payment')!)
    expect(indexById.get('product')!).toBeLessThan(indexById.get('sku')!)
  })
})

describe('BusinessBigMap Full Pipeline (offline)', () => {
  it('runs the complete IR→layout→normalize→validate→materialize pipeline', async () => {
    const { ir } = validateIR(SAMPLE_IR)
    const sized = computeNodeSizes(ir)
    const laid = await layoutWithELK(sized)
    const normalized = normalizeBigMapLayout(laid)
    const { layout } = validateLayout(normalized)
    const { nodes } = materializeBigMapToFlow2Go(layout)

    expect(nodes.length).toBeGreaterThanOrEqual(5)
    const containers = nodes.filter((n) => n.type === 'group')
    expect(containers.length).toBeGreaterThanOrEqual(2)

    for (const n of nodes) {
      expect(n.position.x).toBeDefined()
      expect(n.position.y).toBeDefined()
      expect(n.width).toBeGreaterThan(0)
      expect(n.height).toBeGreaterThan(0)
    }
  })
})
