import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { flushSync } from 'react-dom'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  useReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import {
  AlignLeft,
  AlignCenterHorizontal,
  AlignRight,
  AlignCenterVertical,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  SquareDashedKanban,
} from 'lucide-react'
// import { clearPersistedState } from './persistence'  // 已移除清空功能
import { getProject, saveProject } from './projectStorage'
import styles from './flowEditor.module.css'
import { GroupNode, type GroupNodeData } from './GroupNode'
import { autoLayout, type LayoutDirection } from './layout'
import { QuadNode } from './QuadNode'
import { EditableSmoothStepEdge } from './EditableSmoothStepEdge'
import { ColorEditor } from './ColorEditor'
import { AssetNode, type AssetNodeData } from './AssetNode'
import { GradientColorEditor, type GradientValue } from './GradientColorEditor'
import { TextNode } from './TextNode'
// overview 示例入口已移除

export type AssetItem = {
  id: string
  name: string
  type: 'svg' | 'png'
  dataUrl: string
  width?: number
  height?: number
}

// Template功能已移除
// type TemplateSnapshot = {
//   nodes: FlowNode[]
//   edges: FlowEdge[]
//   viewport: { x: number; y: number; zoom: number }
// }

// Template功能已移除
// type SavedTemplate = {
//   id: string
//   name: string
//   description?: string
//   createdAt: number
//   updatedAt: number
//   snapshot: TemplateSnapshot
// }

// const TEMPLATE_KEY = 'flow2go:templates:v1'
const DND_ASSET_MIME = 'application/flow2go-asset'

type NodeData = {
  label?: string
  color?: string
  labelFontSize?: number
  labelFontWeight?: string
  [key: string]: unknown
}

type FlowNode = Node<NodeData>
type ArrowStyle = 'none' | 'end' | 'start' | 'both'
type EdgeLabelStyle = { fontSize?: number; fontWeight?: string; color?: string }
type FlowEdge = Edge<{
  arrowStyle?: ArrowStyle
}> & { labelStyle?: EdgeLabelStyle }

const DND_MIME = 'application/flow2go-node'
const GRID: [number, number] = [8, 8]
const GROUP_PADDING = GRID[0] // 群组内边距跟随网格
const GROUP_TITLE_H = GRID[1] * 4 // 标题高度为网格的4倍 (32px)

function hexToRgbColor(hex: string): { r: number; g: number; b: number } | null {
  const t = hex.replace(/^#/, '').trim()
  if (t.length !== 3 && t.length !== 6) return null
  if (t.length === 3) {
    const r = parseInt(t[0] + t[0], 16)
    const g = parseInt(t[1] + t[1], 16)
    const b = parseInt(t[2] + t[2], 16)
    return { r, g, b }
  }
  return {
    r: parseInt(t.slice(0, 2), 16),
    g: parseInt(t.slice(2, 4), 16),
    b: parseInt(t.slice(4, 6), 16),
  }
}

function ensureAlpha12(color: string): string {
  const v = color.trim()
  if (!v) return v
  // 已经是 rgba 的，保留用户指定透明度
  if (v.startsWith('rgba')) return v
  // 只有 rgb 的，按 12% 透明度包一层
  if (/^rgb\(/i.test(v)) {
    const m = v.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i)
    if (m) {
      const [r, g, b] = [m[1], m[2], m[3]].map(Number)
      return `rgba(${r},${g},${b},0.12)`
    }
    return v
  }
  // hex 颜色 => rgba(...,0.12)
  const rgb = hexToRgbColor(v)
  if (rgb) return `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`
  const rgb2 = hexToRgbColor('#' + v)
  if (rgb2) return `rgba(${rgb2.r},${rgb2.g},${rgb2.b},0.12)`
  return v
}

/** 边默认颜色与默认终点箭头（React Flow MarkerType），所有新边/未设置箭头的边都带终点箭头 */
const DEFAULT_EDGE_COLOR = '#94a3b8'
const DEFAULT_MARKER_END = {
  type: MarkerType.ArrowClosed,
  color: DEFAULT_EDGE_COLOR,
} as const

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function Sidebar({
  assets,
  onAddAsset,
  onDeleteAsset,
  onAddAiAsset,
  fileName,
  onRenameFile,
  onBackHome,
}: {
  assets: AssetItem[]
  onAddAsset: (files: FileList | null) => void
  onDeleteAsset: (assetId: string) => void
  onAddAiAsset: (dataUrl: string, name: string) => void
  fileName: string
  onRenameFile?: (name: string) => void
  onBackHome?: () => void
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(fileName)
  const [menuOpen, setMenuOpen] = useState<string | null>(null) // asset id or null
  const [assetTab, setAssetTab] = useState<'library' | 'ai'>('library')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // 使用环境变量中的 API Key
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || ''

  useEffect(() => {
    if (!editingTitle) setDraftTitle(fileName)
  }, [fileName, editingTitle])

  const commitTitle = () => {
    const next = draftTitle.trim() || 'untitled'
    onRenameFile?.(next)
    setEditingTitle(false)
  }
  const onDragStart = useCallback((evt: DragEvent, nodeType: string) => {
    evt.dataTransfer.setData(DND_MIME, nodeType)
    // 兼容某些浏览器：没有 text/plain 时 drop 可能不触发
    evt.dataTransfer.setData('text/plain', nodeType)
    evt.dataTransfer.effectAllowed = 'move'
  }, [])

  const onDragStartAsset = useCallback((evt: DragEvent, asset: AssetItem) => {
    evt.dataTransfer.setData(DND_ASSET_MIME, JSON.stringify(asset))
    // 兼容某些浏览器：没有 text/plain 时 drop 可能不触发
    evt.dataTransfer.setData('text/plain', asset.name)
    evt.dataTransfer.effectAllowed = 'copy'
    if (evt.dataTransfer.setDragImage && evt.currentTarget instanceof HTMLElement) {
      const img = new Image()
      img.src = asset.dataUrl
      evt.dataTransfer.setDragImage(img, 24, 24)
    }
  }, [])

  const fileInputRef = useRef<HTMLInputElement>(null)

  // AI 生成图片
  const generateAiAsset = useCallback(async () => {
    if (!aiPrompt.trim() || aiGenerating) return
    setAiGenerating(true)
    setAiError(null)

    // 预设配色范围
    const allowedColors = 'blue (#3b82f6), green (#10b981), orange (#f59e0b), red (#ef4444), purple (#8b5cf6), cyan (#06b6d4), gray (#64748b), black, white'
    
    // 增强 prompt 以确保生成简约透明背景图
    const enhancedPrompt = `A simple, minimalist flat icon of "${aiPrompt.trim()}". Clean design, solid colors only from: ${allowedColors}. No gradients, no shadows, no 3D effects. Centered on transparent background. PNG style, suitable for UI/diagram use. Simple geometric shapes.`

    try {
      // 使用 OpenRouter 的 DALL-E 3 模型生成图片
      const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Flow2Go',
        },
        body: JSON.stringify({
          model: 'openai/dall-e-3',
          prompt: enhancedPrompt,
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json',
        }),
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`API Error: ${response.status} - ${err}`)
      }

      const data = await response.json()
      
      // 从响应中提取 base64 图片数据
      const b64Data = data.data?.[0]?.b64_json
      if (b64Data) {
        const dataUrl = `data:image/png;base64,${b64Data}`
        onAddAiAsset(dataUrl, `ai-${Date.now()}.png`)
        setAiPrompt('')
      } else if (data.data?.[0]?.url) {
        // 如果返回的是 URL，则下载图片
        const imgResponse = await fetch(data.data[0].url)
        const blob = await imgResponse.blob()
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          onAddAiAsset(dataUrl, `ai-${Date.now()}.png`)
          setAiPrompt('')
        }
        reader.readAsDataURL(blob)
      } else {
        throw new Error('未能从响应中获取图片')
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setAiGenerating(false)
    }
  }, [aiPrompt, aiGenerating, onAddAiAsset, apiKey])

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.titleRow}>
          {onBackHome && (
            <button type="button" className={styles.backBtn} onClick={onBackHome} aria-label="返回首页">
              ←
            </button>
          )}
          {editingTitle ? (
            <input
              className={styles.titleInput}
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitTitle()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditingTitle(false)
                  setDraftTitle(fileName)
                }
              }}
            />
          ) : (
            <div
              className={styles.title}
              title={fileName}
              onDoubleClick={() => {
                if (!onRenameFile) return
                setEditingTitle(true)
              }}
            >
              {fileName}
            </div>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>节点库（拖拽到画布）</div>
        <div className={styles.palette}>
          <div className={styles.paletteItem} draggable onDragStart={(e) => onDragStart(e, 'quad')}>
            通用节点（四边连线）
          </div>
          <div className={styles.paletteItem} draggable onDragStart={(e) => onDragStart(e, 'text')}>
            纯文本（无背景）
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>素材</div>
        <div className={styles.assetTabRow}>
          <button
            type="button"
            className={`${styles.assetTabBtn} ${assetTab === 'library' ? styles.assetTabBtnActive : ''}`}
            onClick={() => setAssetTab('library')}
          >
            素材库
          </button>
          <button
            type="button"
            className={`${styles.assetTabBtn} ${assetTab === 'ai' ? styles.assetTabBtnActive : ''}`}
            onClick={() => setAssetTab('ai')}
          >
            AI生成
          </button>
        </div>

        {assetTab === 'library' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".svg,.png,image/svg+xml,image/png"
              multiple
              className={styles.assetInput}
              onChange={(e) => {
                onAddAsset(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className={styles.assetUploadBtn}
              onClick={() => fileInputRef.current?.click()}
            >
              上传 SVG / PNG
            </button>
            <div className={styles.assetGrid}>
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className={styles.assetCard}
                  draggable
                  onDragStart={(e) => onDragStartAsset(e as unknown as DragEvent, asset)}
                >
                  <button
                    type="button"
                    className={styles.assetCardMenu}
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(menuOpen === asset.id ? null : asset.id)
                    }}
                    aria-label="更多操作"
                  >
                    ⋯
                  </button>
                  {menuOpen === asset.id && (
                    <div className={styles.assetCardDropdown}>
                      <button
                        type="button"
                        className={styles.assetCardDropdownItem}
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteAsset(asset.id)
                          setMenuOpen(null)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  )}
                  <div className={styles.assetCardPreview}>
                    <img src={asset.dataUrl} alt={asset.name} />
                  </div>
                  <div className={styles.assetCardName} title={asset.name}>
                    {asset.name}
                  </div>
                </div>
              ))}
            </div>
            {assets.length === 0 && (
              <div className={styles.assetEmpty}>上传后拖拽到画布使用</div>
            )}
          </>
        )}

        {assetTab === 'ai' && (
          <div className={styles.aiSection}>
            <div className={styles.aiNote}>
              输入描述，AI 将生成简约风格的透明背景图标
            </div>
            <textarea
              className={styles.aiPromptInput}
              placeholder="描述你想要的图标，例如：一个蓝色的用户头像图标"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={3}
            />
            <button
              type="button"
              className={styles.aiGenerateBtn}
              disabled={aiGenerating || !aiPrompt.trim() || !apiKey}
              onClick={generateAiAsset}
            >
              {aiGenerating ? '生成中...' : '生成图标'}
            </button>
            {aiError && (
              <div className={styles.aiError}>{aiError}</div>
            )}
            {apiKey && (
              <div className={styles.aiHint}>✓ API Key 已配置</div>
            )}
          </div>
        )}
      </div>

    </aside>
  )
}

// 旧的全局自动持久化已移除

type EditorSource = { kind: 'project'; projectId: string }

type ProjectSnapshot = {
  nodes: unknown[]
  edges: unknown[]
  viewport?: { x: number; y: number; zoom: number }
}

type FlowEditorProps = {
  onBackHome?: () => void
  source: EditorSource
  previewSnapshot?: ProjectSnapshot
  readOnly?: boolean
}

function EditorInner({ onBackHome, source, previewSnapshot, readOnly: _readOnly }: FlowEditorProps) {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  const projectId = source.projectId
  const isPreview = !!previewSnapshot || !!_readOnly

  const initial = useMemo(() => {
    // 预览模式：使用 previewSnapshot
    if (previewSnapshot) {
      return {
        nodes: (previewSnapshot.nodes as FlowNode[]) ?? [],
        edges: (previewSnapshot.edges as FlowEdge[]) ?? [],
        viewport: previewSnapshot.viewport ?? { x: 0, y: 0, zoom: 1 },
        name: '模板预览',
      }
    }
    const proj = getProject(projectId)
    if (!proj?.snapshot) {
      return { nodes: [] as FlowNode[], edges: [] as FlowEdge[], viewport: { x: 0, y: 0, zoom: 1 }, name: 'untitled' }
    }
    const snap = proj.snapshot
    return {
      nodes: (snap.nodes as FlowNode[]) ?? [],
      edges: (snap.edges as FlowEdge[]) ?? [],
      viewport: snap.viewport ?? { x: 0, y: 0, zoom: 1 },
      name: proj.name,
    }
  }, [projectId, previewSnapshot])

  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes)
  const [edges, setEdges] = useState<FlowEdge[]>(initial.edges)
  const nodesEdgesRef = useRef({ nodes: initial.nodes, edges: initial.edges })
  nodesEdgesRef.current = { nodes, edges }

  const [assets, setAssets] = useState<AssetItem[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem('flow2go-assets')
      if (!raw) return []
      const parsed = JSON.parse(raw) as AssetItem[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  // const [templateModalOpen, setTemplateModalOpen] = useState(false)
  // const [templateName, setTemplateName] = useState('')
  // const [templateDesc, setTemplateDesc] = useState('')
  const [fileName, setFileName] = useState(initial.name)
  
  // Save state tracking
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [exportFileName, setExportFileName] = useState('')
  const initialLoadRef = useRef(true)

  // 全局素材池持久化：所有 SVG/PNG 素材存在 localStorage 中，刷新后仍保留（除非显式删除）
  useEffect(() => {
    try {
      window.localStorage.setItem('flow2go-assets', JSON.stringify(assets))
    } catch {
      // ignore persistence errors
    }
  }, [assets])

  // Track unsaved changes - mark dirty when nodes/edges change (skip initial load)
  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false
      return
    }
    setHasUnsavedChanges(true)
  }, [nodes, edges])

  // 项目：文件名与 project.name 同步
  const onRenameFile = useCallback(
    (name: string) => {
      setFileName(name)
      const proj = getProject(projectId)
      if (proj) {
        proj.name = name.trim() || 'untitled'
        proj.updatedAt = Date.now()
        saveProject(proj)
      }
    },
    [projectId],
  )

  // 项目：保存当前画布到 project
  const saveToProject = useCallback(() => {
    const proj = getProject(projectId)
    if (!proj) return
    const { nodes: n, edges: e } = nodesEdgesRef.current
    proj.snapshot = {
      nodes: n,
      edges: e,
      viewport: rf.getViewport(),
    }
    proj.updatedAt = Date.now()
    saveProject(proj)
  }, [projectId, rf])

  // 项目：防抖自动保存（约 1s）
  useEffect(() => {
    if (!projectId) return
    const t = window.setTimeout(() => saveToProject(), 1000)
    return () => window.clearTimeout(t)
  }, [nodes, edges, projectId, saveToProject])

  // 返回首页前先保存
  const handleBackHome = useCallback(() => {
    saveToProject()
    onBackHome?.()
  }, [saveToProject, onBackHome])

  // selection 从 nodes/edges 的 selected 字段派生，避免右键时不同步

  // ---------- Undo / Redo ----------
  type Snapshot = { nodes: FlowNode[]; edges: FlowEdge[]; viewport: { x: number; y: number; zoom: number } }
  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] })
  const lastPushRef = useRef<{ at: number; sig: string } | null>(null)
  const HISTORY_LIMIT = 100

  const snapshotSig = useCallback((n: FlowNode[], e: FlowEdge[]) => `${n.length}/${e.length}`, [])

  const pushHistory = useCallback(
    (nextNodes: FlowNode[], nextEdges: FlowEdge[], reason: string) => {
      const viewport = rf.getViewport()
      const sig = `${reason}:${snapshotSig(nextNodes, nextEdges)}`
      const now = Date.now()
      const last = lastPushRef.current

      // 合并高频变更（拖拽/移动时不会每帧入栈）
      if (last && now - last.at < 250 && last.sig === sig) {
        return
      }

      const present: Snapshot = { nodes: nextNodes, edges: nextEdges, viewport }
      historyRef.current.past.push(present)
      if (historyRef.current.past.length > HISTORY_LIMIT) historyRef.current.past.shift()
      historyRef.current.future = []
      lastPushRef.current = { at: now, sig }
    },
    [rf, snapshotSig],
  )

  const canUndo = historyRef.current.past.length > 0
  // const canRedo = historyRef.current.future.length > 0  // 已移除重做按钮

  const undo = useCallback(() => {
    const past = historyRef.current.past
    if (past.length === 0) return
    const current: Snapshot = { nodes, edges, viewport: rf.getViewport() }
    const prev = past.pop()!
    historyRef.current.future.push(current)
    setNodes(prev.nodes)
    setEdges(prev.edges)
    rf.setViewport(prev.viewport, { duration: 0 })
  }, [edges, nodes, rf])

  const redo = useCallback(() => {
    const future = historyRef.current.future
    if (future.length === 0) return
    const current: Snapshot = { nodes, edges, viewport: rf.getViewport() }
    const next = future.pop()!
    historyRef.current.past.push(current)
    setNodes(next.nodes)
    setEdges(next.edges)
    rf.setViewport(next.viewport, { duration: 0 })
  }, [edges, nodes, rf])

  // ---------- Context Menu ----------
  type MenuState =
    | { open: false }
    | {
        open: true
        x: number
        y: number
        kind: 'pane' | 'node' | 'edge'
        nodeId?: string
        nodeType?: string
        edgeId?: string
        flowPos: { x: number; y: number }
      }

  const [menu, setMenu] = useState<MenuState>({ open: false })

  const closeMenu = useCallback(() => setMenu({ open: false }), [])
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menu.open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('contextmenu', handler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('contextmenu', handler, true)
    }
  }, [menu.open, closeMenu])

  useEffect(() => {
    rf.setViewport(initial.viewport, { duration: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 记录初始快照（用于第一次 undo）
  useEffect(() => {
    pushHistory(nodes, edges, 'init')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onConnect = useCallback(
    (conn: Connection) =>
      setEdges((eds) => {
        const next = addEdge(
          {
            ...conn,
            type: 'smoothstep',
            style: { stroke: DEFAULT_EDGE_COLOR, strokeWidth: 1 },
            markerEnd: { type: MarkerType.ArrowClosed, color: DEFAULT_EDGE_COLOR },
            data: { arrowStyle: 'end' },
          },
          eds,
        )
        pushHistory(nodes, next, 'connect')
        return next
      }),
    [nodes, pushHistory],
  )

  const onSelectionChange = useCallback((_params: OnSelectionChangeParams) => {
    // no-op
  }, [])

  const selectedNodesNow = useMemo(() => nodes.filter((n) => n.selected), [nodes])
  const selectedEdgesNow = useMemo(() => edges.filter((e) => e.selected), [edges])

  const selectedNode = selectedNodesNow[0]
  const selectedEdge = selectedEdgesNow[0]

  const isGroupNode = useCallback((n: FlowNode) => n.type === 'group', [])

  const snapPos = useCallback(
    (pos: { x: number; y: number }) => ({
      x: Math.round(pos.x / GRID[0]) * GRID[0],
      y: Math.round(pos.y / GRID[1]) * GRID[1],
    }),
    [],
  )

  const getNodeSize = useCallback((n: FlowNode) => {
    const w = (n.measured as any)?.width ?? (n as any).width ?? (n.style as any)?.width ?? 160
    const h = (n.measured as any)?.height ?? (n as any).height ?? (n.style as any)?.height ?? 44
    return { w, h }
  }, [])

  const getAbsolutePosition = useCallback((node: FlowNode, byId: Map<string, FlowNode>): { x: number; y: number } => {
    let x = node.position.x
    let y = node.position.y
    let pid = node.parentId
    const seen = new Set<string>()
    while (pid && !seen.has(pid)) {
      seen.add(pid)
      const p = byId.get(pid)
      if (!p) break
      x += p.position.x
      y += p.position.y
      pid = p.parentId
    }
    return { x, y }
  }, [])

  const sortNodesParentFirst = useCallback((nodeList: FlowNode[]): FlowNode[] => {
    const byId = new Map(nodeList.map((n) => [n.id, n]))
    const visited = new Set<string>()
    const result: FlowNode[] = []
    const visit = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      const node = byId.get(id)
      if (!node) return
      if (node.parentId && node.parentId !== id && byId.has(node.parentId)) visit(node.parentId)
      result.push(node)
    }
    for (const n of nodeList) visit(n.id)
    return result
  }, [])

  const assignZIndex = useCallback(
    (all: FlowNode[]) => {
      const byId = new Map(all.map((n) => [n.id, n]))
      const depthMemo = new Map<string, number>()
      const depthOf = (id: string): number => {
        if (depthMemo.has(id)) return depthMemo.get(id)!
        let depth = 0
        let currentId: string | undefined = id
        const seen = new Set<string>()
        while (currentId) {
          if (depthMemo.has(currentId)) { depth += depthMemo.get(currentId)!; break }
          const node = byId.get(currentId)
          if (!node) break
          const pid = node.parentId
          if (!pid) break
          if (seen.has(pid)) break
          seen.add(pid)
          depth += 1
          currentId = pid
        }
        depthMemo.set(id, depth)
        return depth
      }
      return all.map((n) => {
        // 纯文本节点始终在最上层
        if (n.type === 'text') return { ...n, zIndex: 9999 }
        if (!n.parentId) return { ...n, zIndex: isGroupNode(n) ? 0 : 1 }
        const selfDepth = isGroupNode(n) ? depthOf(n.id) : depthOf(n.parentId) + 1
        const zIndex = isGroupNode(n) ? selfDepth * 2 : selfDepth * 2 + 1
        return { ...n, zIndex }
      })
    },
    [isGroupNode],
  )

  // 前移一层 / 后移一层
  const moveLayerUp = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, zIndex: (n.zIndex ?? 0) + 1 } : n,
        )
        pushHistory(updated, edges, 'layer-up')
        return updated
      })
    },
    [edges, pushHistory, setNodes],
  )

  const moveLayerDown = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, zIndex: Math.max(0, (n.zIndex ?? 0) - 1) } : n,
        )
        pushHistory(updated, edges, 'layer-down')
        return updated
      })
    },
    [edges, pushHistory, setNodes],
  )

  // 边的图层控制
  const moveEdgeLayerUp = useCallback(
    (edgeId: string) => {
      setEdges((eds) => {
        const updated = eds.map((e) =>
          e.id === edgeId ? { ...e, zIndex: (e.zIndex ?? 0) + 1 } : e,
        )
        pushHistory(nodes, updated, 'edge-layer-up')
        return updated
      })
    },
    [nodes, pushHistory, setEdges],
  )

  const moveEdgeLayerDown = useCallback(
    (edgeId: string) => {
      setEdges((eds) => {
        const updated = eds.map((e) =>
          e.id === edgeId ? { ...e, zIndex: Math.max(0, (e.zIndex ?? 0) - 1) } : e,
        )
        pushHistory(nodes, updated, 'edge-layer-down')
        return updated
      })
    },
    [nodes, pushHistory, setEdges],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((prev) => {
        const next = applyNodeChanges(changes, prev)
        pushHistory(next, edges, 'nodes')
        return next
      })
    },
    [edges, pushHistory],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds)
        pushHistory(nodes, next, 'edges')
        return next
      })
    },
    [nodes, pushHistory],
  )

  const onDragOver = useCallback((evt: DragEvent) => {
    evt.preventDefault()
    // 根据拖拽内容给出更准确的 dropEffect（也有助于部分浏览器触发 drop）
    const hasAsset = evt.dataTransfer.types?.includes(DND_ASSET_MIME as any)
    evt.dataTransfer.dropEffect = hasAsset ? 'copy' : 'move'
  }, [])

  // 用于 Option+拖动复制：记录原始位置，在 dragStop 时创建副本
  const copyDragRef = useRef<{
    nodeId: string
    originals: { id: string; position: { x: number; y: number }; parentId?: string }[]
  } | null>(null)

  // 用于 Ctrl+C/V 剪贴板
  const clipboardRef = useRef<{
    nodes: FlowNode[]
    edges: FlowEdge[]
  } | null>(null)

  const copySelection = useCallback(() => {
    if (selectedNodesNow.length === 0) return

    // 收集选中节点及其所有子孙
    const collectDescendants = (pid: string): FlowNode[] => {
      const children = nodes.filter((nd) => nd.parentId === pid)
      return children.concat(children.flatMap((c) => collectDescendants(c.id)))
    }

    const toCopy: FlowNode[] = []
    for (const n of selectedNodesNow) {
      toCopy.push(n)
      if (isGroupNode(n)) {
        const desc = collectDescendants(n.id)
        for (const d of desc) {
          if (!toCopy.find((x) => x.id === d.id)) toCopy.push(d)
        }
      }
    }

    // 复制相关的边
    const nodeIds = new Set(toCopy.map((n) => n.id))
    const relatedEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

    clipboardRef.current = { nodes: toCopy, edges: relatedEdges }
  }, [selectedNodesNow, nodes, edges, isGroupNode])

  const pasteSelection = useCallback(() => {
    if (!clipboardRef.current || clipboardRef.current.nodes.length === 0) return

    const { nodes: clipNodes, edges: clipEdges } = clipboardRef.current
    const idMap = new Map<string, string>()

    // 生成新 ID
    clipNodes.forEach((nd) => {
      idMap.set(nd.id, isGroupNode(nd) ? nowId('g') : nowId('n'))
    })

    // 计算偏移（粘贴时稍微偏移）
    const offset = { x: GRID[0] * 4, y: GRID[1] * 4 }

    // 创建新节点
    const newNodes: FlowNode[] = clipNodes.map((nd) => {
      const newId = idMap.get(nd.id)!
      // 如果父节点也在剪贴板中，使用新的父 ID；否则保留原父 ID（粘贴到同一群组内）
      const newParentId = nd.parentId
        ? idMap.get(nd.parentId) ?? nd.parentId
        : undefined
      // 只有顶层节点才偏移位置，子节点保持相对位置
      const isTopLevel = !nd.parentId || !idMap.has(nd.parentId)
      return {
        ...nd,
        id: newId,
        parentId: newParentId,
        position: isTopLevel
          ? snapPos({ x: nd.position.x + offset.x, y: nd.position.y + offset.y })
          : { ...nd.position },
        selected: true,
        data: { ...nd.data }, // 深拷贝 data
      }
    })

    // 创建新边
    const newEdges: FlowEdge[] = clipEdges.map((e) => ({
      ...e,
      id: nowId('e'),
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
      selected: false,
    }))

    // 取消当前选中，添加新节点
    setNodes((nds) => {
      const deselected = nds.map((nd) => ({ ...nd, selected: false }))
      return assignZIndex([...deselected, ...newNodes])
    })
    setEdges((eds) => [...eds.map((e) => ({ ...e, selected: false })), ...newEdges])
    pushHistory([...nodes, ...newNodes], [...edges, ...newEdges], 'paste')
  }, [nodes, edges, isGroupNode, snapPos, assignZIndex, setNodes, setEdges, pushHistory])

  const onNodeDragStart = useCallback(
    (evt: React.MouseEvent, node: FlowNode) => {
      // Option/Alt + 拖动：记录原始位置，稍后在 dragStop 创建副本
      if (!(evt as any).altKey) {
        copyDragRef.current = null
        return
      }

      const nds = rf.getNodes() as FlowNode[]
      const byId = new Map(nds.map((nd) => [nd.id, nd]))
      const original = byId.get(node.id)
      if (!original) return

      if (!isGroupNode(original)) {
        // 单个节点：记录原始位置
        copyDragRef.current = {
          nodeId: node.id,
          originals: [{ id: original.id, position: { ...original.position }, parentId: original.parentId }],
        }
      } else {
        // 群组：收集群组及所有子孙的原始位置
        const collectDescendants = (pid: string): FlowNode[] => {
          const children = nds.filter((nd) => nd.parentId === pid)
          return children.concat(children.flatMap((c) => collectDescendants(c.id)))
        }
        const descendants = collectDescendants(original.id)
        const toClone = [original, ...descendants]
        copyDragRef.current = {
          nodeId: node.id,
          originals: toClone.map((nd) => ({
            id: nd.id,
            position: { ...nd.position },
            parentId: nd.parentId,
          })),
        }
      }
    },
    [rf, isGroupNode],
  )

  const onNodeDragStop = useCallback(
    (_evt: React.MouseEvent, draggedNode: FlowNode) => {
      // Option+拖动复制：原节点保持在拖动后的位置，副本留在原位置
      const copyInfo = copyDragRef.current
      if (copyInfo && copyInfo.nodeId === draggedNode.id) {
        copyDragRef.current = null
        setNodes((nds) => {
          const byId = new Map(nds.map((nd) => [nd.id, nd]))
          const idMap = new Map<string, string>()
          copyInfo.originals.forEach((o) => {
            const node = byId.get(o.id)
            if (node) {
              idMap.set(o.id, isGroupNode(node) ? nowId('g') : nowId('n'))
            }
          })

          // 创建副本（留在原位置）
          const clones: FlowNode[] = []
          for (const o of copyInfo.originals) {
            const node = byId.get(o.id)
            if (!node) continue
            const newId = idMap.get(o.id)
            if (!newId) continue

            // 如果父节点也在复制列表中，使用新父 ID；否则保留原父 ID（在同一群组内复制）
            const newParentId = o.parentId
              ? idMap.get(o.parentId) ?? o.parentId
              : undefined

            // 副本留在原位置
            clones.push({
              ...node,
              id: newId,
              parentId: newParentId,
              position: snapPos(o.position), // 使用原始位置
              selected: false,
              data: { ...node.data },
            })
          }

          // 原节点保持在当前位置（不需要修改）
          if (clones.length === 0) return nds
          const next = assignZIndex([...nds, ...clones])
          pushHistory(next, edges, 'option-copy')
          return next
        })
        return
      }

      setNodes((nds) => {
        const byId = new Map(nds.map((nd) => [nd.id, nd]))
        const node = byId.get(draggedNode.id)
        if (!node) return nds

        const absPos = getAbsolutePosition(node, byId)
        const { w, h } = getNodeSize(node)

        if (node.parentId) {
          const parent = byId.get(node.parentId)
          if (parent) {
            const pAbs = getAbsolutePosition(parent, byId)
            const pw = getNodeSize(parent).w
            const ph = getNodeSize(parent).h
            const ix = Math.min(absPos.x + w, pAbs.x + pw) - Math.max(absPos.x, pAbs.x)
            const iy = Math.min(absPos.y + h, pAbs.y + ph) - Math.max(absPos.y, pAbs.y)
            if (ix <= 0 || iy <= 0) {
              let next = nds.map((nd) =>
                nd.id === node.id ? { ...nd, parentId: undefined, position: absPos } : nd,
              )
              next = sortNodesParentFirst(next)
              next = assignZIndex(next)
              pushHistory(next, edges, 'drag-out')
              return next
            }
          }
        } else if (!isGroupNode(node)) {
          const groups = nds.filter((nd) => isGroupNode(nd) && nd.id !== node.id)
          const centerX = absPos.x + w / 2
          const centerY = absPos.y + h / 2

          let bestGroup: FlowNode | null = null
          let bestDepth = -1
          let bestArea = Infinity

          const depthOfGroup = (g: FlowNode): number => {
            let depth = 0
            let cur: FlowNode | undefined = g
            const seen = new Set<string>()
            while (cur?.parentId && !seen.has(cur.parentId)) {
              seen.add(cur.parentId)
              const p = byId.get(cur.parentId)
              if (!p || !isGroupNode(p)) break
              depth += 1
              cur = p
            }
            return depth
          }

          for (const g of groups) {
            const gAbs = getAbsolutePosition(g, byId)
            const gw = getNodeSize(g).w
            const gh = getNodeSize(g).h

            const centerInside =
              centerX >= gAbs.x &&
              centerX <= gAbs.x + gw &&
              centerY >= gAbs.y &&
              centerY <= gAbs.y + gh
            if (!centerInside) continue

            const depth = depthOfGroup(g)
            const area = gw * gh
            if (depth > bestDepth || (depth === bestDepth && area < bestArea)) {
              bestDepth = depth
              bestArea = area
              bestGroup = g
            }
          }

          if (bestGroup) {
            const gAbs = getAbsolutePosition(bestGroup, byId)
            const relPos = { x: absPos.x - gAbs.x, y: absPos.y - gAbs.y }
            let next = nds.map((nd) =>
              nd.id === node.id ? { ...nd, parentId: bestGroup!.id, position: relPos } : nd,
            )
            next = sortNodesParentFirst(next)
            next = assignZIndex(next)
            pushHistory(next, edges, 'drag-in')
            return next
          }
        }
        return nds
      })
    },
    [assignZIndex, edges, getAbsolutePosition, getNodeSize, isGroupNode, pushHistory, setNodes, snapPos, sortNodesParentFirst],
  )

  const onAddAsset = useCallback((files: FileList | null) => {
    if (!files?.length) return
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith('image/') && (f.type.includes('svg') || f.type.includes('png')),
    )
    if (!imageFiles.length) return
    const baseId = `asset-${Date.now()}`
    let loadedCount = 0
    const toAdd: AssetItem[] = []

    // 从 SVG 文本中解析尺寸
    const parseSvgDimensions = (svgText: string): { width: number; height: number } => {
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgText, 'image/svg+xml')
      const svg = doc.querySelector('svg')
      if (!svg) return { width: 120, height: 80 }

      // 优先使用 width/height 属性
      let w = parseFloat(svg.getAttribute('width') || '')
      let h = parseFloat(svg.getAttribute('height') || '')

      // 如果 width/height 无效，尝试从 viewBox 获取
      if (!w || !h || isNaN(w) || isNaN(h)) {
        const viewBox = svg.getAttribute('viewBox')
        if (viewBox) {
          const parts = viewBox.split(/[\s,]+/).map(Number)
          if (parts.length >= 4) {
            w = parts[2]
            h = parts[3]
          }
        }
      }

      // 如果仍然无效，使用默认值
      if (!w || !h || isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
        return { width: 120, height: 80 }
      }

      return { width: Math.round(w), height: Math.round(h) }
    }

    imageFiles.forEach((file, i) => {
      const type = file.type === 'image/svg+xml' ? 'svg' : 'png'

      if (type === 'svg') {
        // SVG: 先读取文本解析尺寸，再转 dataURL
        const textReader = new FileReader()
        textReader.onload = () => {
          const svgText = textReader.result as string
          const dims = parseSvgDimensions(svgText)

          const urlReader = new FileReader()
          urlReader.onload = () => {
            const dataUrl = urlReader.result as string
            toAdd.push({
              id: `${baseId}-${i}`,
              name: file.name,
              type,
              dataUrl,
              width: dims.width,
              height: dims.height,
            })
            loadedCount++
            if (loadedCount === imageFiles.length) {
              setAssets((prev) => [...prev, ...toAdd])
            }
          }
          urlReader.readAsDataURL(file)
        }
        textReader.readAsText(file)
      } else {
        // PNG: 通过 Image 对象获取尺寸
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          const img = new Image()
          img.onload = () => {
            toAdd.push({
              id: `${baseId}-${i}`,
              name: file.name,
              type,
              dataUrl,
              width: img.naturalWidth || 120,
              height: img.naturalHeight || 80,
            })
            loadedCount++
            if (loadedCount === imageFiles.length) {
              setAssets((prev) => [...prev, ...toAdd])
            }
          }
          img.onerror = () => {
            toAdd.push({
              id: `${baseId}-${i}`,
              name: file.name,
              type,
              dataUrl,
              width: 120,
              height: 80,
            })
            loadedCount++
            if (loadedCount === imageFiles.length) {
              setAssets((prev) => [...prev, ...toAdd])
            }
          }
          img.src = dataUrl
        }
        reader.readAsDataURL(file)
      }
    })
  }, [])

  const onDeleteAsset = useCallback((assetId: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== assetId))
  }, [])

  const onAddAiAsset = useCallback((dataUrl: string, name: string) => {
    const img = new Image()
    img.onload = () => {
      const newAsset: AssetItem = {
        id: `ai-${Date.now()}`,
        name,
        type: 'png',
        dataUrl,
        width: img.naturalWidth || 64,
        height: img.naturalHeight || 64,
      }
      setAssets((prev) => [...prev, newAsset])
    }
    img.src = dataUrl
  }, [])

  const onDrop = useCallback(
    (evt: DragEvent) => {
      evt.preventDefault()
      const rawPos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
      const position = snapPos(rawPos)
      const id = nowId('n')

      const assetJson = evt.dataTransfer.getData(DND_ASSET_MIME)
      if (assetJson) {
        try {
          const asset = JSON.parse(assetJson) as AssetItem
          const base: FlowNode = {
            id,
            type: 'asset',
            position,
            data: {
              assetUrl: asset.dataUrl,
              assetName: asset.name,
              assetType: asset.type,
              assetWidth: asset.width ?? 120,
              assetHeight: asset.height ?? 80,
            },
          }
          setNodes((nds) => {
            const next = nds.concat(base)
            pushHistory(next, edges, 'drop')
            return next
          })
        } catch {
          // ignore
        }
        return
      }

      const nodeType = evt.dataTransfer.getData(DND_MIME)
      if (!nodeType) return

      const base: FlowNode = {
        id,
        type: nodeType === 'quad' ? 'quad' : (nodeType as FlowNode['type']),
        position,
        data: { label: `${nodeType} ${id.slice(-4)}` },
      }

      setNodes((nds) => {
        const next = nds.concat(base)
        pushHistory(next, edges, 'drop')
        return next
      })
    },
    [edges, pushHistory, rf, snapPos],
  )

  const updateSelectedNodeData = useCallback(
    (patch: Partial<NodeData>) => {
      const target = selectedNodesNow[0]
      if (!target) return
      setNodes((nds) =>
        nds.map((n) => (n.id === target.id ? { ...n, data: { ...n.data, ...patch } } : n)),
      )
    },
    [selectedNodesNow, setNodes],
  )

  const updateSelectedEdge = useCallback(
    (patch: Partial<FlowEdge>) => {
      const targetId = selectedEdgesNow[0]?.id
      if (!targetId) return
      const currentEdges = rf.getEdges() as FlowEdge[]
      const next = currentEdges.map((e) => (e.id === targetId ? { ...e, ...patch } : e))
      flushSync(() => rf.setEdges(next))
      setEdges(next)
    },
    [selectedEdgesNow, setEdges, rf],
  )

  // Open save modal with pre-filled filename
  const openSaveModal = useCallback(() => {
    setExportFileName(fileName || 'Flow2Go')
    setSaveModalOpen(true)
  }, [fileName])

  // Actually perform the export/download
  const confirmExport = useCallback(() => {
    const payload = {
      version: 1,
      exportedAt: Date.now(),
      name: exportFileName,
      nodes,
      edges,
      viewport: rf.getViewport(),
      assets, // Include asset library for portability
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = (exportFileName || 'flow2go').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
    a.download = `${safeName}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    
    // Mark as saved
    setHasUnsavedChanges(false)
    setSaveModalOpen(false)
    
    // Also update project name if changed
    if (exportFileName !== fileName) {
      setFileName(exportFileName)
      const proj = getProject(projectId)
      if (proj) {
        proj.name = exportFileName.trim() || 'untitled'
        proj.updatedAt = Date.now()
        saveProject(proj)
      }
    }
  }, [edges, nodes, rf, assets, exportFileName, fileName, projectId])

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const importJson = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // Template功能已移除
  // const saveAsTemplate = useCallback(() => {
  //   setTemplateName(fileName || '')
  //   setTemplateModalOpen(true)
  // }, [fileName])

  // const confirmSaveTemplate = useCallback(async () => {
  //   const name = templateName.trim() || '未命名模板'
  //   const now = Date.now()
  //   const viewport = rf.getViewport()
  //   
  //   const template = {
  //     id: `tpl-${now}-${Math.random().toString(16).slice(2)}`,
  //     name,
  //     description: templateDesc.trim() || undefined,
  //     nodes,
  //     edges,
  //     viewport,
  //   }
  //   
  //   // 保存到后端 API
  //   try {
  //     await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/templates`, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify(template),
  //     })
  //   } catch (err) {
  //     console.error('Failed to save template to API:', err)
  //   }
  //   
  //   // 同时保存到 localStorage 作为备份
  //   try {
  //     const raw = window.localStorage.getItem(TEMPLATE_KEY)
  //     const existing = raw ? JSON.parse(raw) as SavedTemplate[] : []
  //     const next: SavedTemplate = {
  //       id: template.id,
  //       name: template.name,
  //       description: template.description,
  //       createdAt: now,
  //       updatedAt: now,
  //       snapshot: { nodes, edges, viewport },
  //     }
  //     window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify([next, ...existing]))
  //   } catch {
  //     // ignore
  //   }
  //   
  //   setTemplateModalOpen(false)
  //   setTemplateName('')
  //   setTemplateDesc('')
  // }, [edges, nodes, rf, templateDesc, templateName])

  const onImportFile = useCallback(
    async (evt: ChangeEvent<HTMLInputElement>) => {
      const file = evt.target.files?.[0]
      evt.target.value = ''
      if (!file) return
      try {
        const raw = await file.text()
        const parsed = JSON.parse(raw) as {
          name?: string
          nodes?: FlowNode[]
          edges?: FlowEdge[]
          viewport?: { x: number; y: number; zoom: number }
          assets?: AssetItem[]
        }
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return
        const nextNodes = parsed.nodes
        const nextEdges = parsed.edges.map((e) => ({ ...e, type: 'smoothstep' as const }))
        setNodes(nextNodes)
        setEdges(nextEdges)
        if (parsed.viewport) rf.setViewport(parsed.viewport, { duration: 0 })
        pushHistory(nextNodes, nextEdges, 'import')
        
        // Restore project name
        if (parsed.name) {
          setFileName(parsed.name)
        }
        
        // Merge imported assets into library (avoid duplicates by id)
        if (Array.isArray(parsed.assets) && parsed.assets.length > 0) {
          setAssets((prev) => {
            const existingIds = new Set(prev.map((a) => a.id))
            const newAssets = parsed.assets!.filter((a) => !existingIds.has(a.id))
            return [...prev, ...newAssets]
          })
        }
      } catch {
        // ignore
      }
    },
    [pushHistory, rf],
  )

  // 已移除清空并重置按钮
  // const reset = useCallback(() => {
  //   clearPersistedState()
  //   window.location.reload()
  // }, [])

  // overview 示例入口已移除

  const isMac = useMemo(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform), [])
  const [spacePressed, setSpacePressed] = useState(false)

  // 自定义 fitView，避免被左右面板遮挡
  // 左侧面板: 280px + 12px margin = 292px
  // 右侧面板: 320px + 12px margin = 332px
  const customFitView = useCallback(() => {
    // 预览模式下左右各留 400px，正常模式下考虑面板宽度
    const LEFT_PANEL = isPreview ? 400 : 292 + 20  // 左面板 + margin
    const RIGHT_PANEL = isPreview ? 400 : 332 + 20 // 右面板 + margin
    const container = document.querySelector('.react-flow')
    if (!container) {
      rf.fitView({ padding: 0.2 })
      return
    }
    const rect = container.getBoundingClientRect()
    const totalWidth = rect.width
    // fitView 的 padding 是对称的，使用较大的一侧作为水平 padding
    const maxPanelWidth = Math.max(LEFT_PANEL, RIGHT_PANEL)
    const horizontalPadding = totalWidth > 0 ? maxPanelWidth / totalWidth : 0.2
    rf.fitView({ padding: Math.max(0.1, horizontalPadding) })
  }, [rf, isPreview])

  // 预览模式初始加载时自动 fit 并应用安全区
  useEffect(() => {
    if (isPreview) {
      // 延迟执行以确保 ReactFlow 已渲染
      const t = setTimeout(customFitView, 100)
      return () => clearTimeout(t)
    }
  }, [isPreview, customFitView])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ---------- Helpers: grouping ----------

  const groupSelection = useCallback(() => {
    if (selectedNodesNow.length < 2) return

    // 关键逻辑：如果选择里包含群组，它的子节点只作为“群组的一部分”，
    // 不再作为独立顶层元素参与分组/排版，避免被打散到同一层级。
    const byId = new Map(nodes.map((nd) => [nd.id, nd]))
    const selectedGroupIds = new Set(selectedNodesNow.filter((n) => isGroupNode(n)).map((n) => n.id))
    const isUnderSelectedGroup = (node: FlowNode): boolean => {
      let pid = node.parentId
      const seen = new Set<string>()
      while (pid && !seen.has(pid)) {
        if (selectedGroupIds.has(pid)) return true
        seen.add(pid)
        const pNode = byId.get(pid)
        pid = pNode?.parentId
      }
      return false
    }

    const picked = selectedNodesNow.filter(
      (n) => isGroupNode(n) || !isUnderSelectedGroup(n),
    )
    if (picked.length < 2) return

    const absMap = new Map<string, { x: number; y: number }>()
    for (const n of picked) absMap.set(n.id, getAbsolutePosition(n, byId))

    const bounds = picked.reduce(
      (acc, n) => {
        const pos = absMap.get(n.id)!
        const { w, h } = getNodeSize(n)
        acc.minX = Math.min(acc.minX, pos.x)
        acc.minY = Math.min(acc.minY, pos.y)
        acc.maxX = Math.max(acc.maxX, pos.x + w)
        acc.maxY = Math.max(acc.maxY, pos.y + h)
        return acc
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    )

    const groupId = nowId('g')
    const title = `群组 ${groupId.slice(-4)}`
    // 左侧标题不占用垂直高度，只在左右挤出空间；顶部标题才需要预留 titleH
    const titleH = 0

    const parents = new Set(picked.map((n) => n.parentId).filter(Boolean) as string[])
    const commonParentId = parents.size === 1 ? [...parents][0] : undefined

    const groupAbsX = bounds.minX - GROUP_PADDING
    const groupAbsY = bounds.minY - GROUP_PADDING - titleH
    const groupW = bounds.maxX - bounds.minX + GROUP_PADDING * 2
    const groupH = bounds.maxY - bounds.minY + GROUP_PADDING * 2 + titleH

    let groupPos: { x: number; y: number }
    if (commonParentId) {
      const pp = byId.get(commonParentId)
      const ppAbs = pp ? getAbsolutePosition(pp, byId) : { x: 0, y: 0 }
      groupPos = { x: groupAbsX - ppAbs.x, y: groupAbsY - ppAbs.y }
    } else {
      groupPos = { x: groupAbsX, y: groupAbsY }
    }

    const groupNode: FlowNode = {
      id: groupId,
      type: 'group',
      position: groupPos,
      ...(commonParentId ? { parentId: commonParentId } : {}),
      width: groupW,
      height: groupH,
      data: {
        title,
        titlePosition: 'left-center',
        stroke: '#3b82f6',
        fill: 'rgba(59, 130, 246, 0.10)',
      } satisfies GroupNodeData,
      draggable: true,
      style: { width: groupW, height: groupH },
    }

    setNodes((nds) => {
      const pickedIds = new Set(picked.map((p) => p.id))
      let next = nds.map((n) => {
        if (!pickedIds.has(n.id)) return n
        const absPos = absMap.get(n.id) ?? getAbsolutePosition(n, byId)
        return {
          ...n,
          parentId: groupId,
          position: { x: absPos.x - groupAbsX, y: absPos.y - groupAbsY },
        }
      })
      next = next.concat(groupNode)
      next = sortNodesParentFirst(next)
      next = assignZIndex(next)
  const updateGroupStyle = useCallback(
    (groupId: string, patch: Partial<GroupNodeData>) => {
      setNodes((nds) => {
        const next = nds.map((n) => (n.id === groupId ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n))
      pushHistory(next, edges, 'group')
      return next
    })
  }, [assignZIndex, edges, getAbsolutePosition, getNodeSize, isGroupNode, nodes, pushHistory, selectedNodesNow, sortNodesParentFirst])

        pushHistory(next, edges, 'group-style')
        return next
      })
    },
    [edges, pushHistory],
  )

  /** 根据子节点自动排版：调整编组大小与位置以包裹所有子节点 */
      pushHistory(next, edges, 'group')
      return next
    })
  }, [assignZIndex, edges, getAbsolutePosition, getNodeSize, isGroupNode, nodes, pushHistory, selectedNodesNow, sortNodesParentFirst])

  const fitGroupToChildren = useCallback(
    (groupId: string) => {
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const group = byId.get(groupId)
      if (!group || !isGroupNode(group)) return
      const children = nodes.filter((n) => n.parentId === groupId)
      if (children.length === 0) return

      const bounds = children.reduce(
        (acc, n) => {
          const pos = getAbsolutePosition(n, byId)
          const { w, h } = getNodeSize(n)
          acc.minX = Math.min(acc.minX, pos.x)
          acc.minY = Math.min(acc.minY, pos.y)
          acc.maxX = Math.max(acc.maxX, pos.x + w)
          acc.maxY = Math.max(acc.maxY, pos.y + h)
          return acc
        },
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )
      const title = (group.data as GroupNodeData)?.title?.trim()
      // 自动包裹时，同样只在有顶部标题时才额外预留高度；当前默认是左侧标题，按 1 格 GAP 计算
      const titlePos = (group.data as GroupNodeData)?.titlePosition ?? 'top-center'
      const titleH = title && titlePos === 'top-center' ? GROUP_TITLE_H : 0
      const groupAbsX = bounds.minX - GROUP_PADDING
      const groupAbsY = bounds.minY - GROUP_PADDING - titleH
      const groupW = bounds.maxX - bounds.minX + GROUP_PADDING * 2
      const groupH = bounds.maxY - bounds.minY + GROUP_PADDING * 2 + titleH

      setNodes((nds) => {
        const byId2 = new Map(nds.map((n) => [n.id, n]))
        const groupAbs = group.parentId
          ? getAbsolutePosition(byId2.get(group.parentId)!, byId2)
          : { x: 0, y: 0 }
        const groupPos = {
          x: groupAbsX - (group.parentId ? groupAbs.x : 0),
          y: groupAbsY - (group.parentId ? groupAbs.y : 0),
        }
        const childIds = new Set(children.map((c) => c.id))
        let next = nds.map((n) => {
          if (n.id === groupId) {
            return {
              ...n,
              position: groupPos,
              width: groupW,
              height: groupH,
              style: { ...(n.style as object), width: groupW, height: groupH },
            }
          }
          if (!childIds.has(n.id)) return n
          const absPos = getAbsolutePosition(n, byId2)
          return {
            ...n,
            position: { x: absPos.x - groupAbsX, y: absPos.y - groupAbsY },
          }
        })
        next = sortNodesParentFirst(next)
        next = assignZIndex(next)
        pushHistory(next, edges, 'fit-group')
        return next
      })
    },
    [assignZIndex, edges, getAbsolutePosition, getNodeSize, isGroupNode, nodes, pushHistory, sortNodesParentFirst],
  )

  const updateGroupStyle = useCallback(
    (groupId: string, patch: Partial<GroupNodeData>) => {
      setNodes((nds) => {
        const next = nds.map((n) => (n.id === groupId ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n))
        pushHistory(next, edges, 'group-style')
        return next
      })
      // 当标题位置发生变化（无论切到上方还是左侧）时，都自动根据子节点重新包裹编组，
      // 这样可以在左侧模式预留标题带，在上方模式预留顶部标题区，并保持 GAP。
      if (Object.prototype.hasOwnProperty.call(patch, 'titlePosition')) {
        window.setTimeout(() => fitGroupToChildren(groupId), 0)
      }
    },
    [edges, fitGroupToChildren, pushHistory],
  )

  // Group 双击标题编辑：来自 GroupNode 的自定义事件
  useEffect(() => {
    const handler = (evt: Event) => {
      const ce = evt as CustomEvent<{ id: string; title: string }>
      const id = ce.detail?.id
      if (!id) return
      updateGroupStyle(id, { title: ce.detail.title })
    }
    window.addEventListener('flow2go:group-title', handler as any)
    return () => window.removeEventListener('flow2go:group-title', handler as any)
  }, [updateGroupStyle])

  const align = useCallback(
    (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hspace' | 'vspace') => {
      const picked = selectedNodesNow.filter((n) => n.type !== 'group')
      if (picked.length < 2) return

      const widths = new Map(picked.map((n) => [n.id, n.measured?.width ?? n.width ?? 180]))
      const heights = new Map(picked.map((n) => [n.id, n.measured?.height ?? n.height ?? 44]))

      const xs = picked.map((n) => n.position.x)
      const ys = picked.map((n) => n.position.y)
      const rights = picked.map((n) => n.position.x + (widths.get(n.id) ?? 0))
      const bottoms = picked.map((n) => n.position.y + (heights.get(n.id) ?? 0))

      const targetLeft = Math.min(...xs)
      const targetTop = Math.min(...ys)
      const targetRight = Math.max(...rights)
      const targetBottom = Math.max(...bottoms)
      const targetHCenter = (targetLeft + targetRight) / 2
      const targetVCenter = (targetTop + targetBottom) / 2

      const items = picked
        .map((n) => {
          const w = widths.get(n.id) ?? 180
          const h = heights.get(n.id) ?? 44
          return {
            id: n.id,
            w,
            h,
            x: n.position.x,
            y: n.position.y,
            cx: n.position.x + w / 2,
            cy: n.position.y + h / 2,
          }
        })
        .sort((a, b) => (mode === 'hspace' ? a.cx - b.cx : a.cy - b.cy))

      setNodes((nds) => {
        const next = nds.map((n) => {
          if (!picked.some((p) => p.id === n.id)) return n
          const w = widths.get(n.id) ?? 180
          const h = heights.get(n.id) ?? 44

          if (mode === 'left') return { ...n, position: snapPos({ x: targetLeft, y: n.position.y }) }
          if (mode === 'right') return { ...n, position: snapPos({ x: targetRight - w, y: n.position.y }) }
          if (mode === 'hcenter') return { ...n, position: snapPos({ x: targetHCenter - w / 2, y: n.position.y }) }
          if (mode === 'top') return { ...n, position: snapPos({ x: n.position.x, y: targetTop }) }
          if (mode === 'bottom') return { ...n, position: snapPos({ x: n.position.x, y: targetBottom - h }) }
          if (mode === 'vcenter') return { ...n, position: snapPos({ x: n.position.x, y: targetVCenter - h / 2 }) }

          if (mode === 'hspace' && items.length >= 3) {
            const idx = items.findIndex((it) => it.id === n.id)
            if (idx <= 0 || idx >= items.length - 1) return n
            const first = items[0]
            const last = items[items.length - 1]
            const span = last.cx - first.cx
            if (span <= 0) return n
            const step = span / (items.length - 1)
            const newCx = first.cx + step * idx
            const newX = newCx - w / 2
            return { ...n, position: snapPos({ x: newX, y: n.position.y }) }
          }

          if (mode === 'vspace' && items.length >= 3) {
            const idx = items.findIndex((it) => it.id === n.id)
            if (idx <= 0 || idx >= items.length - 1) return n
            const first = items[0]
            const last = items[items.length - 1]
            const span = last.cy - first.cy
            if (span <= 0) return n
            const step = span / (items.length - 1)
            const newCy = first.cy + step * idx
            const newY = newCy - h / 2
            return { ...n, position: snapPos({ x: n.position.x, y: newY }) }
          }

          return n
        })
        pushHistory(next, edges, `align:${mode}`)
        return next
      })
    },
    [edges, pushHistory, selectedNodesNow, snapPos],
  )

  const runLayout = useCallback(
    (dir: LayoutDirection) => {
      const picked = selectedNodesNow
      if (picked.length < 2) return

      const pickedIds = new Set(picked.map((n) => n.id))
      const subEdges = edges.filter((e) => pickedIds.has(e.source) && pickedIds.has(e.target))

      const oldBounds = picked.reduce(
        (acc, n) => {
          const w = n.measured?.width ?? n.width ?? 180
          const h = n.measured?.height ?? n.height ?? 44
          return {
            minX: Math.min(acc.minX, n.position.x),
            minY: Math.min(acc.minY, n.position.y),
            maxX: Math.max(acc.maxX, n.position.x + w),
            maxY: Math.max(acc.maxY, n.position.y + h),
          }
        },
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )
      const oldCx = (oldBounds.minX + oldBounds.maxX) / 2
      const oldCy = (oldBounds.minY + oldBounds.maxY) / 2

      const laid = autoLayout(picked, subEdges, dir)
      const newBounds = laid.reduce(
        (acc, n) => {
          const w = n.measured?.width ?? n.width ?? 180
          const h = n.measured?.height ?? n.height ?? 44
          return {
            minX: Math.min(acc.minX, n.position.x),
            minY: Math.min(acc.minY, n.position.y),
            maxX: Math.max(acc.maxX, n.position.x + w),
            maxY: Math.max(acc.maxY, n.position.y + h),
          }
        },
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      )
      const newCx = (newBounds.minX + newBounds.maxX) / 2
      const newCy = (newBounds.minY + newBounds.maxY) / 2
      const dx = oldCx - newCx
      const dy = oldCy - newCy

      const laidById = new Map(laid.map((n) => [n.id, n]))

      setNodes((nds) => {
        const next = nds.map((n) => {
          const ln = laidById.get(n.id)
          if (!ln) return n
          return { ...n, position: snapPos({ x: ln.position.x + dx, y: ln.position.y + dy }) }
        })
        pushHistory(next, edges, `layout:${dir}`)
        return next
      })
    },
    [edges, pushHistory, selectedNodesNow, snapPos],
  )

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const src = nodes.find((n) => n.id === nodeId)
      if (!src) return
      const id = nowId('n')
      const base: FlowNode = {
        ...src,
        id,
        position: snapPos({ x: src.position.x + 24, y: src.position.y + 24 }),
        selected: false,
      }
      setNodes((nds) => {
        const next = nds.concat(base)
        pushHistory(next, edges, 'dup')
        return next
      })
    },
    [edges, nodes, pushHistory],
  )

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const byId = new Map(nds.map((nd) => [nd.id, nd]))
        let next = nds.map((n) => {
          if (n.parentId !== nodeId) return n
          const absPos = getAbsolutePosition(n, byId)
          return { ...n, parentId: undefined, position: absPos }
        })
        next = next.filter((n) => n.id !== nodeId)
        next = sortNodesParentFirst(next)
        pushHistory(next, edges, 'delnode')
        return next
      })
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
    },
    [edges, getAbsolutePosition, pushHistory, sortNodesParentFirst],
  )

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => {
        const next = eds.filter((e) => e.id !== edgeId)
        pushHistory(nodes, next, 'deledge')
        return next
      })
    },
    [nodes, pushHistory],
  )

  const deleteSelection = useCallback(() => {
    if (!selectedNodesNow.length && !selectedEdgesNow.length) return
    const nodeIds = new Set(selectedNodesNow.map((n) => n.id))
    const edgeIds = new Set(selectedEdgesNow.map((ed) => ed.id))

    const nextNodes = nodes.filter((n) => !nodeIds.has(n.id))
    const nextEdges = edges.filter((ed) => !edgeIds.has(ed.id) && !nodeIds.has(ed.source) && !nodeIds.has(ed.target))

    setNodes(nextNodes)
    setEdges(nextEdges)
    pushHistory(nextNodes, nextEdges, 'delete')
  }, [edges, nodes, pushHistory, selectedEdgesNow, selectedNodesNow])

  // 右键菜单：画布/节点/边
  const onPaneContextMenu = useCallback(
    (evt: MouseEvent | React.MouseEvent) => {
      // 画布空白处右键不做任何反馈，只阻止默认浏览器菜单
      ;(evt as any).preventDefault?.()
    },
    [],
  )

  // 框选时会出现 selection-rect 覆盖层，可能吃掉右键事件；这里用 capture 阶段兜底。
  const onCanvasContextMenuCapture = useCallback(
    (evt: React.MouseEvent) => {
      // 只有选中多个节点时才显示菜单
      if (selectedNodesNow.length < 2) {
        evt.preventDefault()
        return
      }
      evt.preventDefault()
      evt.stopPropagation()
      const x = evt.clientX
      const y = evt.clientY
      const flowPos = rf.screenToFlowPosition({ x, y })
      setMenu({ open: true, x, y, kind: 'pane', flowPos })
    },
    [rf, selectedNodesNow.length],
  )

  const onNodeContextMenu = useCallback(
    (evt: MouseEvent | React.MouseEvent, node: FlowNode) => {
      ;(evt as any).preventDefault?.()
      const x = (evt as any).clientX as number
      const y = (evt as any).clientY as number
      const flowPos = rf.screenToFlowPosition({ x, y })
      setMenu({ open: true, x, y, kind: 'node', nodeId: node.id, nodeType: node.type, flowPos })
    },
    [rf],
  )

  const onEdgeContextMenu = useCallback(
    (evt: MouseEvent | React.MouseEvent, edge: FlowEdge) => {
      ;(evt as any).preventDefault?.()
      const x = (evt as any).clientX as number
      const y = (evt as any).clientY as number
      const flowPos = rf.screenToFlowPosition({ x, y })
      setMenu({ open: true, x, y, kind: 'edge', edgeId: edge.id, flowPos })
    },
    [rf],
  )

  const onEdgeDoubleClick = useCallback(
    (evt: React.MouseEvent, edge: FlowEdge) => {
      evt.stopPropagation()
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edge.id
            ? { ...e, data: { ...(e.data ?? {}), editingLabel: true } }
            : { ...e, data: { ...(e.data ?? {}), editingLabel: false } },
        ),
      )
    },
    [setEdges],
  )

  // selectedNode / selectedEdge 已在上方派生
  const nodeTypesFull = useMemo(
    () => ({
      group: GroupNode,
      quad: QuadNode,
      asset: AssetNode,
      text: TextNode,
    }),
    [],
  )

  const edgeTypes = useMemo(() => ({ smoothstep: EditableSmoothStepEdge }), [])

  // ---------- Shortcuts（放在所有动作定义之后，避免 TDZ） ----------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return

      const mod = isMac ? e.metaKey : e.ctrlKey

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodesNow.length || selectedEdgesNow.length) e.preventDefault()
        deleteSelection()
        return
      }

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveToProject()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        const n = selectedNodesNow[0]
        if (!n) return
        e.preventDefault()
        duplicateNode(n.id)
        return
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        copySelection()
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        pasteSelection()
        return
      }
      if (e.key.toLowerCase() === 'g') {
        if (selectedNodesNow.length >= 2) {
          e.preventDefault()
          groupSelection()
        }
        return
      }
      // 自动对齐/对齐入口仅通过右键菜单提供
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    copySelection,
    deleteSelection,
    duplicateNode,
    openSaveModal,
    groupSelection,
    isMac,
    pasteSelection,
    redo,
    saveToProject,
    selectedEdgesNow,
    selectedNodesNow,
    undo,
  ])

  return (
    <div className={`${styles.editor} xy-theme`}>
      {!isPreview && (
        <Sidebar
          assets={assets}
          onAddAsset={onAddAsset}
          onDeleteAsset={onDeleteAsset}
          onAddAiAsset={onAddAiAsset}
          fileName={fileName}
          onRenameFile={onRenameFile}
          onBackHome={onBackHome ? handleBackHome : undefined}
        />
      )}

      <main
        className={styles.canvas}
        data-space-pan={spacePressed ? true : undefined}
        onContextMenuCapture={onCanvasContextMenuCapture}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={isPreview ? undefined : onNodesChange}
          onEdgesChange={isPreview ? undefined : onEdgesChange}
          onConnect={isPreview ? undefined : onConnect}
          onSelectionChange={isPreview ? undefined : onSelectionChange}
          onNodeDragStart={isPreview ? undefined : onNodeDragStart}
          onNodeDragStop={isPreview ? undefined : onNodeDragStop}
          onDrop={isPreview ? undefined : onDrop}
          onDragOver={isPreview ? undefined : onDragOver}
          onPaneContextMenu={isPreview ? undefined : onPaneContextMenu}
          onNodeContextMenu={isPreview ? undefined : onNodeContextMenu}
          onEdgeContextMenu={isPreview ? undefined : onEdgeContextMenu}
          onEdgeDoubleClick={isPreview ? undefined : onEdgeDoubleClick}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 1 }}
          deleteKeyCode={isPreview ? [] : ['Backspace', 'Delete']}
          panOnDrag={isPreview ? true : spacePressed}
          selectionOnDrag={isPreview ? false : !spacePressed}
          selectionMode={SelectionMode.Full}
          multiSelectionKeyCode={isPreview ? [] : 'Shift'}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          snapToGrid={!isPreview}
          snapGrid={GRID}
          nodeTypes={nodeTypesFull}
          edgeTypes={edgeTypes}
          nodesDraggable={isPreview ? false : !spacePressed}
          nodesConnectable={isPreview ? false : !spacePressed}
          elementsSelectable={isPreview ? false : !spacePressed}
          defaultEdgeOptions={{
            type: 'smoothstep',
            style: { stroke: DEFAULT_EDGE_COLOR, strokeWidth: 1 },
            markerEnd: { ...DEFAULT_MARKER_END },
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <MiniMap zoomable pannable />
          <Controls />

          <Panel position="top-left" className={styles.topPanel}>
            {!isPreview && (
              <>
                <button className={styles.btn} type="button" onClick={undo} disabled={!canUndo}>
                  撤销
                </button>
                <button className={styles.btn} type="button" onClick={importJson}>
                  导入文件
                </button>
                <button className={hasUnsavedChanges ? styles.btnUnsaved : styles.btnSaved} style={{ marginLeft: 'auto' }} type="button" onClick={openSaveModal}>
                  {hasUnsavedChanges ? '未保存' : '✓ 已保存'}
                </button>
              </>
            )}
          </Panel>

          {menu.open && (
            <div
              ref={menuRef}
              className={styles.menu}
              style={{ left: menu.x, top: menu.y }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {selectedNodesNow.length >= 2 && (
                <>
                  <button className={styles.menuItem} type="button" onClick={() => (groupSelection(), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>
                        <SquareDashedKanban size={14} />
                      </span>
                      <span>群组</span>
                    </span>
                    <span className={styles.menuKbd}>G</span>
                  </button>
                  <button className={styles.menuItem} type="button" onClick={() => (runLayout('LR'), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>
                        <AlignHorizontalDistributeCenter size={14} />
                      </span>
                      <span>自动排列</span>
                    </span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button className={styles.menuItem} type="button" onClick={() => (align('left'), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>
                        <AlignLeft size={14} />
                      </span>
                      <span>左对齐</span>
                    </span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button className={styles.menuItem} type="button" onClick={() => (align('hcenter'), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>
                        <AlignCenterHorizontal size={14} />
                      </span>
                      <span>水平居中</span>
                    </span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button className={styles.menuItem} type="button" onClick={() => (align('right'), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>
                        <AlignRight size={14} />
                      </span>
                      <span>右对齐</span>
                    </span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button className={styles.menuItem} type="button" onClick={() => (align('top'), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>⯅</span>
                      <span>顶对齐</span>
                    </span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button className={styles.menuItem} type="button" onClick={() => (align('vcenter'), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>
                        <AlignCenterVertical size={14} />
                      </span>
                      <span>垂直居中</span>
                    </span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button className={styles.menuItem} type="button" onClick={() => (align('bottom'), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>⯆</span>
                      <span>底对齐</span>
                    </span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button className={styles.menuItem} type="button" onClick={() => (align('hspace'), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>
                        <AlignHorizontalDistributeCenter size={14} />
                      </span>
                      <span>水平等距</span>
                    </span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button className={styles.menuItem} type="button" onClick={() => (align('vspace'), closeMenu())}>
                    <span className={styles.menuLabel}>
                      <span className={styles.menuIcon}>
                        <AlignVerticalDistributeCenter size={14} />
                      </span>
                      <span>垂直等距</span>
                    </span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button className={styles.menuItemDanger} type="button" onClick={() => (deleteSelection(), closeMenu())}>
                    <span>删除</span>
                    <span className={styles.menuKbd}>Del</span>
                  </button>
                </>
              )}
              {menu.kind === 'node' && (
                <>
                  {menu.nodeType !== 'asset' && menu.nodeType !== 'text' && (
                    <button
                      className={styles.menuItem}
                      type="button"
                      onClick={() => (menu.nodeId ? duplicateNode(menu.nodeId) : undefined, closeMenu())}
                    >
                      <span>复制节点</span>
                      <span className={styles.menuKbd}>Ctrl/Cmd+D</span>
                    </button>
                  )}
                  {menu.nodeType === 'group' && menu.nodeId && (
                    <button
                      className={styles.menuItem}
                      type="button"
                      onClick={() => {
                        fitGroupToChildren(menu.nodeId!)
                        closeMenu()
                      }}
                    >
                      <span className={styles.menuLabel}>
                        <span className={styles.menuIcon}>
                          <AlignHorizontalDistributeCenter size={14} />
                        </span>
                        <span>根据子节点调整大小</span>
                      </span>
                    </button>
                  )}
                  {menu.nodeType === 'asset' && menu.nodeId && (
                    <button
                      className={styles.menuItem}
                      type="button"
                      onClick={() => {
                        const node = nodes.find((n) => n.id === menu.nodeId)
                        if (node && node.type === 'asset') {
                          const data = node.data as { src?: string; name?: string }
                          if (data.src) {
                            onAddAiAsset(data.src, data.name || `asset-${Date.now()}.png`)
                          }
                        }
                        closeMenu()
                      }}
                    >
                      <span>存入素材库</span>
                      <span className={styles.menuKbd}></span>
                    </button>
                  )}
                  <button
                    className={styles.menuItem}
                    type="button"
                    onClick={() => (menu.nodeId ? moveLayerUp(menu.nodeId) : undefined, closeMenu())}
                  >
                    <span>前移一层</span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button
                    className={styles.menuItem}
                    type="button"
                    onClick={() => (menu.nodeId ? moveLayerDown(menu.nodeId) : undefined, closeMenu())}
                  >
                    <span>后移一层</span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button
                    className={styles.menuItemDanger}
                    type="button"
                    onClick={() => (menu.nodeId ? deleteNode(menu.nodeId) : undefined, closeMenu())}
                  >
                    <span>
                      {menu.nodeType === 'asset'
                        ? '删除素材'
                        : menu.nodeType === 'text'
                          ? '删除文本'
                          : '删除节点'}
                    </span>
                    <span className={styles.menuKbd}>Del</span>
                  </button>
                  {/* 分组折叠已移除（按需求：群组只是外框容器） */}
                </>
              )}

              {menu.kind === 'edge' && (
                <>
                  <button
                    className={styles.menuItem}
                    type="button"
                    onClick={() => (menu.edgeId ? moveEdgeLayerUp(menu.edgeId) : undefined, closeMenu())}
                  >
                    <span>前移一层</span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button
                    className={styles.menuItem}
                    type="button"
                    onClick={() => (menu.edgeId ? moveEdgeLayerDown(menu.edgeId) : undefined, closeMenu())}
                  >
                    <span>后移一层</span>
                    <span className={styles.menuKbd}></span>
                  </button>
                  <button
                    className={styles.menuItemDanger}
                    type="button"
                    onClick={() => (menu.edgeId ? deleteEdge(menu.edgeId) : undefined, closeMenu())}
                  >
                    <span>删除边</span>
                    <span className={styles.menuKbd}>Del</span>
                  </button>
                </>
              )}
            </div>
        )}
        </ReactFlow>

        <input
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
          accept="application/json,.json"
          onChange={onImportFile}

            {selectedNode.type === 'asset' && (
              <div className={styles.mutedSmall}>
                素材节点 · {(selectedNode.data as any)?.assetName ?? '—'}
                <br />
                {(selectedNode.data as any)?.assetWidth ?? 120} ×{' '}
                {(selectedNode.data as any)?.assetHeight ?? 80} 像素（选中后拖拽边角拉伸）
              </div>
            )}

            {/* SVG 素材颜色覆盖 */}
            {selectedNode.type === 'asset' && (selectedNode.data as AssetNodeData)?.assetType === 'svg' && (
              <div className={styles.form}>
                <div className={styles.formTitle}>颜色覆盖（仅SVG）</div>
                <GradientColorEditor
                  value={(selectedNode.data as AssetNodeData)?.colorOverride ?? { type: 'solid' }}
                  onChange={(v: GradientValue) => updateSelectedNodeData({ colorOverride: v })}
                />
              </div>
            )}

            {selectedNode.type !== 'asset' && selectedNode.type !== 'group' && selectedNode.type !== 'text' && (
              <>
                {/* 副标题开关 - 仅 quad 节点 */}
                {selectedNode.type === 'quad' && (
                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={!!(selectedNode.data as any)?.showSubtitle}
                      onChange={(e) => updateSelectedNodeData({ showSubtitle: e.target.checked })}
                    />
                    显示副标题
                  </label>
                )}
                <label className={styles.label}>
                  <div className={styles.labelText}>文字颜色</div>
                  <ColorEditor
                    value={(selectedNode.data as any)?.labelColor ?? '#000000'}
                    onChange={(v) => updateSelectedNodeData({ labelColor: v })}
                    placeholder="#000000"
                    showAlpha={true}
                  />
                </label>
                <label className={styles.label}>
                  <div className={styles.labelText}>填充颜色（MiniMap/节点样式）</div>
                  <ColorEditor
                    value={selectedNode.data?.color ?? '#ffffff'}
                    onChange={(v) => updateSelectedNodeData({ color: v })}
                    placeholder="#ffffff"
                    showAlpha={true}
                  />
                </label>
                <label className={styles.label}>
                  <div className={styles.labelText}>描边颜色</div>
                  <ColorEditor
                    value={(selectedNode.data as any)?.stroke ?? '#e2e8f0'}
                    onChange={(v) => updateSelectedNodeData({ stroke: v })}
                    placeholder="#e2e8f0"
                    showAlpha={true}
                  />
                </label>
                <label className={styles.label}>
                  <div className={styles.labelText}>描边粗细</div>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    step={1}
                    value={(selectedNode.data as any)?.strokeWidth ?? 1}
                    onChange={(e) => {
                      const val = e.target.value
                      const num = parseFloat(val)
                      updateSelectedNodeData({ strokeWidth: Number.isFinite(num) && num >= 0 ? num : 1 })
                    }}
                    placeholder="1"
                  />
                </label>
              </>
            )}

            {selectedNode.type === 'group' && (
              <>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => fitGroupToChildren(selectedNode.id)}
                >
                  根据子节点调整大小
                </button>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={!!((selectedNode.data as GroupNodeData | undefined)?.showSubtitle)}
                    onChange={(e) => updateGroupStyle(selectedNode.id, { showSubtitle: e.target.checked })}
                  />
                  显示副标题
                </label>
                <label className={styles.label}>
                  <div className={styles.labelText}>标题位置</div>
                  <select
                    className={styles.input}
                    value={(selectedNode.data as GroupNodeData | undefined)?.titlePosition ?? 'top-center'}
                    onChange={(e) => updateGroupStyle(selectedNode.id, { titlePosition: e.target.value as 'top-center' | 'left-center' })}
                  >
                    <option value="top-center">上方居中</option>
                    <option value="left-center">左侧居中</option>
                  </select>
                </label>
                <label className={styles.label}>
                  <div className={styles.labelText}>标题文字颜色</div>
                  <ColorEditor
                    value={((selectedNode.data as GroupNodeData | undefined)?.titleColor ?? '') as string}
                    onChange={(v) => updateGroupStyle(selectedNode.id, { titleColor: v })}
                    placeholder="rgba(0,0,0,0.8)"
                    showAlpha={true}
                  />
                </label>
                <label className={styles.label}>
                  <div className={styles.labelText}>描边颜色</div>
                  <ColorEditor
                    value={((selectedNode.data as GroupNodeData | undefined)?.stroke ?? '') as string}
                    onChange={(v) => updateGroupStyle(selectedNode.id, { stroke: v })}
                    placeholder="#3b82f6"
                    showAlpha={true}
                  />
                </label>
                <label className={styles.label}>
                  <div className={styles.labelText}>描边粗细</div>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    step={1}
                    value={((selectedNode.data as GroupNodeData | undefined)?.strokeWidth ?? 1)}
                    onChange={(e) => {
                      const val = e.target.value
                      const num = parseFloat(val)
                      updateGroupStyle(selectedNode.id, { strokeWidth: Number.isFinite(num) && num >= 0 ? num : 1 })
                    }}
                    placeholder="1"
                  />
                </label>
                <label className={styles.label}>
                  <div className={styles.labelText}>底色（hex + 透明度或 rgba）</div>
                  <ColorEditor
                    value={((selectedNode.data as GroupNodeData | undefined)?.fill ?? '') as string}
                    onChange={(v) => updateGroupStyle(selectedNode.id, { fill: ensureAlpha12(v) })}
                    placeholder="rgba(59,130,246,0.12)"
                    showPicker={true}
                    showAlpha={true}
                  />
                </label>
              </>
            )}
          </div>
        />
      </main>

      {!isPreview && (
        <aside className={styles.inspector}>
          <div className={styles.sectionTitle}>属性面板</div>

        {!selectedNode && !selectedEdge && <div className={styles.muted}>未选中节点/边</div>}

        {selectedNode && (
          <div className={styles.form}>
            <div className={styles.formTitle}>
              {selectedNode.type === 'group'
                ? `群组：${((selectedNode.data as GroupNodeData | undefined)?.title ||
                    '未命名群组') as string}`
                : selectedNode.type === 'asset'
                ? `素材：${((selectedNode.data as any)?.assetName || '未命名素材') as string}`
                : `节点：${(((selectedNode.data as any)?.title ??
                    selectedNode.data?.label ??
                    '未命名节点') as string)}`}
            </div>
          </label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={Boolean(selectedEdge.animated)}
                onChange={(e) => updateSelectedEdge({ animated: e.target.checked })}
              />
              <span>Animated</span>
            </label>
          </div>
        )}

        {selectedEdge && (
          <div className={styles.form}>
            <div className={styles.formTitle}>边：{selectedEdge.id}</div>
            <label className={styles.label}>
              <div className={styles.labelText}>Label</div>
              <input
                className={styles.input}
                value={(selectedEdge.label as string) ?? ''}
                onChange={(e) => updateSelectedEdge({ label: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              <div className={styles.labelText}>文字大小</div>
              <input
                className={styles.input}
                type="number"
                min={10}
                max={72}
                placeholder="12"
                value={
                  (selectedEdge as FlowEdge).labelStyle?.fontSize ??
                  (selectedEdge.data as any)?.labelStyle?.fontSize ??
                  ''
                }
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : undefined
                  const next: EdgeLabelStyle = {
                    ...(selectedEdge as FlowEdge).labelStyle,
                    fontSize: Number.isFinite(v) ? v : undefined,
                    fontWeight: (selectedEdge as FlowEdge).labelStyle?.fontWeight,
                  }
                  updateSelectedEdge({
                    labelStyle: next,
                    data: { ...(selectedEdge.data ?? {}), labelStyle: next },
                  } as any)
                }}
              />
            </label>
            <label className={styles.label}>
              <div className={styles.labelText}>文字粗细</div>
              <select
                className={styles.input}
                value={
                  (selectedEdge as FlowEdge).labelStyle?.fontWeight ??
                  (selectedEdge.data as any)?.labelStyle?.fontWeight ??
                  '400'
                }
                onChange={(e) => {
                  const next: EdgeLabelStyle = {
                    ...(selectedEdge as FlowEdge).labelStyle,
                    fontWeight: e.target.value,
                    fontSize: (selectedEdge as FlowEdge).labelStyle?.fontSize,
                    color: (selectedEdge as FlowEdge).labelStyle?.color ?? (selectedEdge.data as any)?.labelStyle?.color,
                  }
                  updateSelectedEdge({
                    labelStyle: next,
                    data: { ...(selectedEdge.data ?? {}), labelStyle: next },
                  } as any)
                }}
              >
                <option value="400">常规</option>
                <option value="500">中等</option>
                <option value="600">半粗</option>
                <option value="700">粗体</option>
                <option value="800">特粗</option>
              </select>
            </label>
            <label className={styles.label}>
              <div className={styles.labelText}>文字颜色</div>
              <ColorEditor
                value={
                  (selectedEdge as FlowEdge).labelStyle?.color ??
                  (selectedEdge.data as any)?.labelStyle?.color ??
                  ''
                }
                onChange={(v) => {
                  const next: EdgeLabelStyle = {
                    ...(selectedEdge as FlowEdge).labelStyle,
                    fontSize: (selectedEdge as FlowEdge).labelStyle?.fontSize,
                    fontWeight: (selectedEdge as FlowEdge).labelStyle?.fontWeight,
                    color: v,
                  }
                  updateSelectedEdge({
                    labelStyle: next,
                    data: { ...(selectedEdge.data ?? {}), labelStyle: next },
                  } as any)
                }}
                placeholder="#0f172a"
                showAlpha={true}
              />
            </label>
            <label className={styles.label}>
              <div className={styles.labelText}>颜色</div>
              <ColorEditor
                value={((selectedEdge.style as any)?.stroke as string) ?? ''}
                onChange={(color) => {
                  const data = (selectedEdge.data ?? {}) as any
                  const arrowStyle = (data.arrowStyle as ArrowStyle | undefined) ?? 'none'
                  let markerStart = selectedEdge.markerStart as any
                  let markerEnd = selectedEdge.markerEnd as any
                  if (arrowStyle === 'start' || arrowStyle === 'both') {
                    markerStart = {
                      ...(markerStart ?? {}),
                      type: MarkerType.ArrowClosed,
                      color,
                    }
                  } else markerStart = undefined
                  if (arrowStyle === 'end' || arrowStyle === 'both') {
                    markerEnd = {
                      ...(markerEnd ?? {}),
                      type: MarkerType.ArrowClosed,
                      color,
                    }
                  } else markerEnd = undefined
                  updateSelectedEdge({
                    style: {
                      ...(selectedEdge.style ?? {}),
                      stroke: color,
                      '--xy-edge-stroke': color,
                    } as any,
                    markerStart,
                    markerEnd,
                  })
                }}
                placeholder="#94a3b8"
                showAlpha={true}
              />
            </label>
          <label className={styles.label}>
            <div className={styles.labelText}>粗细</div>
            <input
              className={styles.input}
              type="number"
              min={1}
              max={10}
              step={0.5}
              placeholder="2"
              value={
                ((selectedEdge.style as any)?.strokeWidth as number | undefined) !== undefined
                  ? String((selectedEdge.style as any)?.strokeWidth as number)
                  : ''
              }
              onChange={(e) => {
                const raw = e.target.value
                const num = Number(raw)
                updateSelectedEdge({
                  style: {
                    ...(selectedEdge.style ?? {}),
                    strokeWidth: !raw ? undefined : Number.isFinite(num) && num > 0 ? num : (selectedEdge.style as any)?.strokeWidth,
                  },
                })
              }}
            />
          </label>
          <label className={styles.label}>
            <div className={styles.labelText}>箭头</div>
            <div className={styles.radioGroup}>
              <label className={styles.radioItem}>
                <input
                  type="radio"
                  name="edge-arrow-style"
                  checked={(selectedEdge.data as any)?.arrowStyle === 'none' || !(selectedEdge.data as any)?.arrowStyle}
                  onChange={() =>
                    updateSelectedEdge({
                      data: { ...(selectedEdge.data ?? {}), arrowStyle: 'none' },
                      markerStart: undefined,
                      markerEnd: undefined,
                    } as any)
                  }
                />
                <span>无箭头</span>
              </label>
              <label className={styles.radioItem}>
                <input
                  type="radio"
                  name="edge-arrow-style"
                  checked={(selectedEdge.data as any)?.arrowStyle === 'end'}
                  onChange={() => {
                    const color =
                      ((selectedEdge.style as any)?.stroke as string) || DEFAULT_EDGE_COLOR
                    updateSelectedEdge({
                      data: { ...(selectedEdge.data ?? {}), arrowStyle: 'end' },
                      markerStart: undefined,
                      markerEnd: { type: MarkerType.ArrowClosed, color },
                      style: { ...(selectedEdge.style ?? {}), stroke: color },
                    } as any)
                  }}
                />
                <span>终点箭头</span>
              </label>
              <label className={styles.radioItem}>
                <input
                  type="radio"
                  name="edge-arrow-style"
                  checked={(selectedEdge.data as any)?.arrowStyle === 'start'}
                  onChange={() => {
                    const color =
                      ((selectedEdge.style as any)?.stroke as string) || DEFAULT_EDGE_COLOR
                    updateSelectedEdge({
                      data: { ...(selectedEdge.data ?? {}), arrowStyle: 'start' },
                      markerStart: { type: MarkerType.ArrowClosed, color },
                      markerEnd: undefined,
                      style: { ...(selectedEdge.style ?? {}), stroke: color },
                    } as any)
                  }}
                />
                <span>起点箭头</span>
              </label>
              <label className={styles.radioItem}>
                <input
                  type="radio"
                  name="edge-arrow-style"
                  checked={(selectedEdge.data as any)?.arrowStyle === 'both'}
                  onChange={() => {
                    const color =
                      ((selectedEdge.style as any)?.stroke as string) || DEFAULT_EDGE_COLOR
                    updateSelectedEdge({
                      data: { ...(selectedEdge.data ?? {}), arrowStyle: 'both' },
                      markerStart: { type: MarkerType.ArrowClosed, color },
                      markerEnd: { type: MarkerType.ArrowClosed, color },
                      style: { ...(selectedEdge.style ?? {}), stroke: color },
                    } as any)
                  }}
                />
                <span>双向箭头</span>
              </label>
            </div>
          )}

        {/* Template modal removed */}
        </aside>
      )}

      {/* Save Modal */}
      {saveModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setSaveModalOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>保存文件</div>
            <input
              className={styles.modalInput}
              type="text"
              value={exportFileName}
              onChange={(e) => setExportFileName(e.target.value)}
              placeholder="输入文件名"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmExport()
                }
              }}
            />
            <div className={styles.modalHint}>文件将保存为 {exportFileName || 'Flow2Go'}.json</div>
            <div className={styles.modalFooter}>
              <button className={styles.btn} type="button" onClick={() => setSaveModalOpen(false)}>
                取消
              </button>
              <button className={styles.btnPrimary} type="button" onClick={confirmExport}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner
        onBackHome={props.onBackHome}
        source={props.source}
        previewSnapshot={props.previewSnapshot}
        readOnly={props.readOnly}
      />
    </ReactFlowProvider>
  )
}

