import type { Edge, Node } from '@xyflow/react'

export const overviewNodes: Node[] = [
  {
    id: 'a-1',
    type: 'annotation',
    position: { x: 40, y: 40 },
    data: { level: 'info', label: '这是 React Flow Overview 示例能力的一个子集实现：自定义节点、NodeToolbar、NodeResizer、自定义 Edge 标签按钮等。' },
    draggable: false,
    selectable: false,
  },
  {
    id: 'c-1',
    type: 'circle',
    position: { x: 120, y: 220 },
    data: { label: 'Circle' },
  },
  {
    id: 't-1',
    type: 'tools',
    position: { x: 380, y: 190 },
    data: { label: 'Toolbar Node' },
  },
  {
    id: 'r-1',
    type: 'resizer',
    position: { x: 680, y: 170 },
    data: { label: 'Resizer Node' },
    style: { width: 240, height: 140 },
  },
  {
    id: 'i-1',
    type: 'textinput',
    position: { x: 380, y: 360 },
    data: { label: 'Text Input', value: 'hello' },
  },
]

export const overviewEdges: Edge[] = [
  { id: 'e-c-t', source: 'c-1', target: 't-1' },
  { id: 'e-t-r', source: 't-1', target: 'r-1', type: 'button' },
  { id: 'e-t-i', source: 't-1', target: 'i-1', animated: true },
]

