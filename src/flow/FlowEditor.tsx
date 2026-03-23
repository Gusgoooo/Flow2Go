import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
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
  useStoreApi,
  useUpdateNodeInternals,
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
import JSZip from 'jszip'
import {
  AlignHorizontalDistributeCenter,
  KeyRound,
  InspectionPanel,
  Settings2,
  SquareDashedKanban,
  Square,
  Type,
  X,
} from 'lucide-react'
// import { clearPersistedState } from './persistence'  // 已移除清空功能
import defaultExample from './defaultExample.json'
import { getProject, saveProject } from './projectStorage'
import styles from './flowEditor.module.css'
import { GroupNode, type GroupNodeData } from './GroupNode'
import { autoLayout, type LayoutDirection } from './layout'
import { QuadNode } from './QuadNode'
import { EditableSmoothStepEdge } from './EditableSmoothStepEdge'
import { EditableBezierEdge } from './EditableBezierEdge'
import { EdgeLabelLayoutProvider } from './edgeLabels/SmartEdgeLabel'
import type { EdgeLabelLayoutConfig } from './edgeLabels/types'
import { AssetNode } from './AssetNode'
import { TextNode } from './TextNode'
import { InlineInspector } from './InlineInspector'
import { findBestParentFrame, getNodeAbsolutePosition, getNodeSizeLike, isFrameNode } from './frameUtils'
import { NodeEditPopup } from './NodeEditPopup'
import { GroupEditPopup } from './GroupEditPopup'
import { EdgeEditPopup } from './EdgeEditPopup'
import { AssetEditPopup } from './AssetEditPopup'
import {
  openRouterGenerateDiagram,
  normalizeAiDiagramToSnapshot,
  type AiDiagramDraft,
  type AiDiagramSceneHint,
  type AiGenerateProgressInfo,
} from './aiDiagram'
import { AI_SCENE_CAPSULE_PRESETS } from './aiPromptPresets'
import { AiSceneCapsules } from './AiSceneCapsules'
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
  labelLayout?: EdgeLabelLayoutConfig
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
  aiDiagramDraft,
  fileName,
  onRenameFile,
  onBackHome,
  containerClassName,
}: {
  assets: AssetItem[]
  onAddAsset: (files: FileList | null) => void
  onDeleteAsset: (assetId: string) => void
  onAddAiAsset: (dataUrl: string, name: string) => void
  aiDiagramDraft: AiDiagramDraft | null
  fileName: string
  onRenameFile?: (name: string) => void
  onBackHome?: () => void
  containerClassName?: string
}) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(fileName)
  const [menuOpen, setMenuOpen] = useState<string | null>(null) // asset id or null
  const [assetTab, setAssetTab] = useState<'library' | 'ai'>('library')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [openRouterKey, setOpenRouterKey] = useState<string>(() => {
    try {
      return localStorage.getItem('flow2go-openrouter-key') || ''
    } catch {
      return ''
    }
  })
  const apiKey = openRouterKey.trim()
  const [dslModalOpen, setDslModalOpen] = useState(false)

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('flow2go:sidebarWidth')
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) ? n : 280
    } catch {
      return 280
    }
  })
  const sidebarResizeRef = useRef<{ active: boolean; startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem('flow2go-openrouter-key', openRouterKey)
    } catch {}
  }, [openRouterKey])

  useEffect(() => {
    try {
      localStorage.setItem('flow2go:sidebarWidth', String(sidebarWidth))
    } catch {}
  }, [sidebarWidth])

  useEffect(() => {
    if (!editingTitle) setDraftTitle(fileName)
  }, [fileName, editingTitle])

  const commitTitle = () => {
    const next = draftTitle.trim() || 'untitled'
    onRenameFile?.(next)
    setEditingTitle(false)
  }
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
          'Authorization': `Bearer ${apiKey.trim()}`,
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
    <aside
      className={`${styles.sidebar} ${containerClassName ?? ''}`}
      style={{ width: Math.max(240, Math.min(520, sidebarWidth)) }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="拖动调整侧边栏宽度"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
          sidebarResizeRef.current = { active: true, startX: e.clientX, startWidth: sidebarWidth }
        }}
        onPointerMove={(e) => {
          const ref = sidebarResizeRef.current
          if (!ref?.active) return
          const delta = e.clientX - ref.startX
          const next = Math.max(240, Math.min(520, ref.startWidth + delta))
          setSidebarWidth(next)
        }}
        onPointerUp={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const ref = sidebarResizeRef.current
          if (ref) ref.active = false
          ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
        }}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 10,
          cursor: 'ew-resize',
          // 放在容器内部，避免被 overflow:hidden 裁剪
          background: 'linear-gradient(to left, rgba(148,163,184,0.20), rgba(148,163,184,0.00))',
          zIndex: 999,
          pointerEvents: 'auto',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 12,
          right: 3,
          bottom: 12,
          width: 2,
          borderRadius: 2,
          background: 'rgba(148, 163, 184, 0.22)',
          zIndex: 998,
          pointerEvents: 'none',
        }}
      />
      <div className={styles.sidebarInner}>
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

        <div className={styles.sidebarScroll}>
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
            <div className={styles.aiApiKeySection}>
              <div className={styles.aiNote}>OpenRouter API Key（仅保存在本地浏览器）</div>
              <input
                className={styles.aiApiKeyInput}
                value={openRouterKey}
                onChange={(e) => setOpenRouterKey(e.target.value)}
                placeholder="sk-or-..."
              />
              <div className={styles.aiHint}>
                {apiKey ? '✓ 已配置（localStorage）' : '未配置：需要先填写才能使用 AI'}
              </div>
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
          </div>
        )}

        {/* AI图入口已移除：改为顶栏全屏模态 */}
      </div>

      {dslModalOpen && aiDiagramDraft && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setDslModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.55)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(860px, 96vw)',
              maxHeight: '86vh',
              background: '#0b1220',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              borderRadius: 12,
              padding: 12,
              color: '#e2e8f0',
              boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>自然语言 → Mermaid DSL</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(aiDiagramDraft.rawText || '')
                    } catch {}
                  }}
                >
                  复制
                </button>
                <button type="button" className={styles.btnSecondary} onClick={() => setDslModalOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
            <textarea
              className={styles.aiPromptInput}
              readOnly
              rows={18}
              value={aiDiagramDraft.rawText}
              style={{ flex: 1, minHeight: 280 }}
            />
            <div className={styles.aiNote} style={{ opacity: 0.9 }}>
              提示：这里展示的是模型输出的 Mermaid DSL 原文（已用于本地映射 nodes/edges）。
            </div>
          </div>
        </div>
      )}

        </div>
        <div className={styles.sidebarFooter}>
          所有记录都储存在本地，保证您的数据安全
        </div>
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
  const storeApi = useStoreApi<FlowNode, FlowEdge>()
  const projectId = source.projectId
  const isPreview = !!previewSnapshot || !!_readOnly
  const [assetsPopupOpen, setAssetsPopupOpen] = useState(false)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiModalPrompt, setAiModalPrompt] = useState('')
  /** 与胶囊绑定：生成时传入 diagramScene；点 ✕ 取消高亮并清空输入框 */
  const [aiModalScene, setAiModalScene] = useState<AiDiagramSceneHint | null>(null)
  const [aiConfigOpen, setAiConfigOpen] = useState(false)
  const [aiModalGenerating, setAiModalGenerating] = useState(false)
  /** 生成阶段文案（与控制台 [Flow2Go AI] 日志对应，用于区分慢 / 卡在某一步 / 失败） */
  const [aiModalProgress, setAiModalProgress] = useState<{ phase: string; detail?: string } | null>(null)
  const [aiGenElapsedSec, setAiGenElapsedSec] = useState(0)
  const [aiModalError, setAiModalError] = useState<string | null>(null)
  const aiModalAbortRef = useRef<AbortController | null>(null)
  const [aiModalModel, setAiModalModel] = useState<string>(() => {
    try {
      return localStorage.getItem('flow2go-openrouter-model') || 'openai/gpt-5.4-nano'
    } catch {
      return 'openai/gpt-5.4-nano'
    }
  })
  const [aiModalKey, setAiModalKey] = useState<string>(() => {
    try {
      return localStorage.getItem('flow2go-openrouter-key') || ''
    } catch {
      return ''
    }
  })

  const [inlineInspector, setInlineInspector] = useState<{
    kind: 'node' | 'group' | 'edge' | null
    id: string | null
    x: number
    y: number
  }>({ kind: null, id: null, x: 0, y: 0 })

  /** 点击节点时弹出的形状选择工具栏（仅 quad 节点） */
  const [shapePopup, setShapePopup] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  /** 点击边时弹出的边属性 popup */
  const [edgePopup, setEdgePopup] = useState<{ edgeId: string; x: number; y: number } | null>(null)
  /** 全局文字编辑锁：任意文字编辑 popup 打开时为 true */
  const [textEditLock, setTextEditLock] = useState(false)

  // 文本编辑时（标题/副标题双击），关闭节点/编组/边等其它浮层，只保留文字编辑工具条
  useEffect(() => {
    const handler = () => {
      setShapePopup(null)
      setEdgePopup(null)
      setInlineInspector({ kind: null, id: null, x: 0, y: 0 })
    }
    window.addEventListener('flow2go:close-popups-for-text', handler)
    return () => window.removeEventListener('flow2go:close-popups-for-text', handler)
  }, [])

  // 任意文字编辑开始/结束时，锁定/解锁所有选中菜单栏（防止点颜色弹出色板时菜单又回来）
  useEffect(() => {
    const handler = (evt: Event) => {
      const ce = evt as CustomEvent<{ active?: boolean }>
      const active = Boolean(ce.detail?.active)
      setTextEditLock(active)
      if (active) {
        setShapePopup(null)
        setEdgePopup(null)
        setInlineInspector({ kind: null, id: null, x: 0, y: 0 })
      }
    }
    window.addEventListener('flow2go:text-editing', handler as any)
    return () => window.removeEventListener('flow2go:text-editing', handler as any)
  }, [])

  /** 生成中每秒刷新，便于判断「仍在跑」还是界面卡死 */
  useEffect(() => {
    if (!aiModalGenerating) {
      setAiGenElapsedSec(0)
      return
    }
    const start = Date.now()
    setAiGenElapsedSec(0)
    const id = window.setInterval(() => {
      setAiGenElapsedSec(Math.floor((Date.now() - start) / 1000))
    }, 500)
    return () => window.clearInterval(id)
  }, [aiModalGenerating])

  const initial = useMemo(() => {
    // 预览模式：使用 previewSnapshot
    if (previewSnapshot) {
      return {
        nodes: (previewSnapshot.nodes as FlowNode[]) ?? [],
        edges: (previewSnapshot.edges as FlowEdge[]) ?? [],
        viewport: previewSnapshot.viewport ?? { x: 0, y: 0, zoom: 1 },
        name: '模板预览',
        isDefaultExample: false,
      }
    }
    const proj = getProject(projectId)
    const snap = proj?.snapshot as any
    const hasValidSnapshot =
      snap &&
      Array.isArray(snap.nodes) &&
      Array.isArray(snap.edges) &&
      (snap.nodes.length > 0 || snap.edges.length > 0)
    if (!hasValidSnapshot) {
      // 用户第一次打开产品：使用默认示例并居中展示
      return {
        nodes: (defaultExample.nodes as FlowNode[]) ?? [],
        edges: (defaultExample.edges as FlowEdge[]) ?? [],
        viewport: (defaultExample as any).viewport ?? { x: 0, y: 0, zoom: 1 },
        name: 'untitled',
        isDefaultExample: true,
      }
    }
    const snap2 = (proj as any).snapshot
    return {
      nodes: (snap2.nodes as FlowNode[]) ?? [],
      edges: (snap2.edges as FlowEdge[]) ?? [],
      viewport: snap2.viewport ?? { x: 0, y: 0, zoom: 1 },
      name: proj?.name ?? 'untitled',
      isDefaultExample: false,
    }
  }, [projectId, previewSnapshot])

  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes)
  const [edges, setEdges] = useState<FlowEdge[]>(initial.edges)
  const nodesEdgesRef = useRef({ nodes: initial.nodes, edges: initial.edges })
  nodesEdgesRef.current = { nodes, edges }

  // ---------- AI：生成整张图（草稿 -> 应用） ----------
  const [aiDiagramDraft, setAiDiagramDraft] = useState<AiDiagramDraft | null>(null)

  // 传给 React Flow 的节点列表：为群组补全有效宽高，避免 0/undefined 导致框选时 nodeToRect 得到 0×0 矩形被误判为在选区内的“点”
  const nodesForFlow = useMemo(() => {
    return nodes.map((n) => {
      if (n.type !== 'group') return n
      const w = (n.measured as { width?: number })?.width ?? (n as { width?: number }).width ?? (n.style as { width?: number })?.width
      const h = (n.measured as { height?: number })?.height ?? (n as { height?: number }).height ?? (n.style as { height?: number })?.height
      const hasW = typeof w === 'number' && w > 0
      const hasH = typeof h === 'number' && h > 0
      if (hasW && hasH) return n
      const safeW = hasW ? w! : 160
      const safeH = hasH ? h! : 120
      return {
        ...n,
        width: safeW,
        height: safeH,
        style: { ...(n.style as object ?? {}), width: safeW, height: safeH },
      } as FlowNode
    })
  }, [nodes])

  const updateNodeInternals = useUpdateNodeInternals()
  // 初次渲染或节点集合变化后，延迟强制刷新 React Flow 内部节点尺寸/位置，避免框选时仍用未更新的 measured 导致误选
  const nodeIdsKey = useMemo(() => nodes.map((n) => n.id).sort().join(','), [nodes])
  useEffect(() => {
    const ids = nodes.map((n) => n.id)
    const t = setTimeout(() => {
      if (ids.length) updateNodeInternals(ids)
    }, 120)
    return () => clearTimeout(t)
  }, [nodeIdsKey, nodes, updateNodeInternals])

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
  const [_hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
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
    setHasUnsavedChanges(false)
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

  const applyAiDraftDirect = useCallback(
    (draft: AiDiagramDraft) => {
      const snap = normalizeAiDiagramToSnapshot(draft)
      const nextNodes = (snap.nodes ?? []) as FlowNode[]
      const nextEdges = (snap.edges ?? []) as FlowEdge[]
      setNodes(nextNodes)
      setEdges(nextEdges)
      pushHistory(nextNodes, nextEdges, 'ai-apply')
      if (snap.viewport) rf.setViewport(snap.viewport, { duration: 0 })
    },
    [pushHistory, rf],
  )

  // const _canUndo = historyRef.current.past.length > 0
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
        clientX: number
        clientY: number
        kind: 'pane' | 'node' | 'edge'
        nodeId?: string
        nodeType?: string
        edgeId?: string
        flowPos: { x: number; y: number }
      }

  const [menu, setMenu] = useState<MenuState>({ open: false })
  const [menuFixedPos, setMenuFixedPos] = useState<{ left: number; top: number } | null>(null)

  const closeMenu = useCallback(() => setMenu({ open: false }), [])
  const menuRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLElement | null>(null)

  // 通用右键菜单定位：根据菜单自身尺寸 + 视口边界动态决定摆放位置，避免固定 transform 或越界导致“被限制在某个位置”
  useLayoutEffect(() => {
    if (!menu.open) {
      setMenuFixedPos(null)
      return
    }

    const margin = 8
    const anchorX = menu.clientX
    const anchorY = menu.clientY

    const compute = () => {
      const el = menuRef.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const w = rect.width || 220
      const h = rect.height || 180

      // 优先向右下展开；若越界则翻转到左/上
      let left = anchorX + 6
      let top = anchorY + 6

      if (left + w + margin > window.innerWidth) left = anchorX - w - 6
      if (top + h + margin > window.innerHeight) top = anchorY - h - 6

      // 最终 clamp 到视口内
      left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - w - margin))
      top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - h - margin))

      setMenuFixedPos({ left, top })
    }

    // 下一帧测量更稳定
    const raf = requestAnimationFrame(compute)
    window.addEventListener('resize', compute)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', compute)
    }
  }, [menu.open, menu.open ? menu.clientX : 0, menu.open ? menu.clientY : 0])

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
    if (initial.isDefaultExample) {
      rf.fitView({ padding: 0.2, duration: 0 })
    } else {
      rf.setViewport(initial.viewport, { duration: 0 })
    }
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
            style: { stroke: DEFAULT_EDGE_COLOR, strokeWidth: 2 },
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

  // const _selectedNode = selectedNodesNow[0]
  // const _selectedEdge = selectedEdgesNow[0]

  const isGroupNode = useCallback((n: FlowNode) => n.type === 'group', [])

  const snapPos = useCallback(
    (pos: { x: number; y: number }) => ({
      x: Math.round(pos.x / GRID[0]) * GRID[0],
      y: Math.round(pos.y / GRID[1]) * GRID[1],
    }),
    [],
  )

  const getNodeSize = useCallback((n: FlowNode) => {
    const { width, height } = getNodeSizeLike(n as any)
    return { w: width, h: height }
  }, [])

  const getAbsolutePosition = useCallback((node: FlowNode, byId: Map<string, FlowNode>): { x: number; y: number } => {
    return getNodeAbsolutePosition(node as any, byId as any)
  }, [])

  /** 在已有节点列表中找一个与 flowPos 尽量接近且不重叠的位置（用于新节点，减少框选误选） */
  const findNonOverlappingPosition = useCallback(
    (
      flowPos: { x: number; y: number },
      existingNodes: FlowNode[],
      newW: number,
      newH: number,
    ): { x: number; y: number } => {
      const byId = new Map(existingNodes.map((n) => [n.id, n]))
      const margin = GRID[0] * 2 // 16px 间距，与节点明显分离
      const candidates: { x: number; y: number }[] = [{ x: flowPos.x, y: flowPos.y }]
      const step = Math.max(newW, newH) + margin
      for (let i = 1; i <= 4; i++) {
        const d = step * i
        candidates.push({ x: flowPos.x + d, y: flowPos.y })
        candidates.push({ x: flowPos.x, y: flowPos.y + d })
        candidates.push({ x: flowPos.x + d, y: flowPos.y + d })
        candidates.push({ x: flowPos.x - d, y: flowPos.y })
        candidates.push({ x: flowPos.x, y: flowPos.y - d })
        candidates.push({ x: flowPos.x - d, y: flowPos.y - d })
      }
      for (const pos of candidates) {
        const snapped = snapPos(pos)
        const nL = snapped.x
        const nT = snapped.y
        const nR = nL + newW + margin
        const nB = nT + newH + margin
        let overlaps = false
        for (const n of existingNodes) {
          const abs = getAbsolutePosition(n, byId)
          const { w, h } = getNodeSize(n)
          const l = abs.x - margin
          const t = abs.y - margin
          const r = abs.x + w + margin
          const b = abs.y + h + margin
          if (nL < r && nR > l && nT < b && nB > t) {
            overlaps = true
            break
          }
        }
        if (!overlaps) return snapped
      }
      return snapPos(flowPos)
    },
    [getAbsolutePosition, getNodeSize, snapPos],
  )

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

  const inlineNode = useMemo(
    () => (inlineInspector.id && inlineInspector.kind !== 'edge' ? nodes.find((n) => n.id === inlineInspector.id) : undefined),
    [inlineInspector.id, inlineInspector.kind, nodes],
  )

  const inlineEdge = useMemo(
    () => (inlineInspector.id && inlineInspector.kind === 'edge' ? edges.find((e) => e.id === inlineInspector.id) : undefined),
    [inlineInspector.id, inlineInspector.kind, edges],
  )

  // 文字编辑模式：由全局事件统一控制（节点/群组/文本/边）
  const textEditingActive = textEditLock

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

  // 节点图层控制（前移一层 / 后移一层）
  const moveNodeLayerUp = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, zIndex: (n.zIndex ?? 0) + 1 } : n,
        )
        pushHistory(updated, edges, 'node-layer-up')
        return updated
      })
    },
    [edges, pushHistory, setNodes],
  )

  const moveNodeLayerDown = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, zIndex: Math.max(0, (n.zIndex ?? 0) - 1) } : n,
        )
        pushHistory(updated, edges, 'node-layer-down')
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
      // 多选拖动节点时，让被选中节点之间的连线控制点（waypoints）也随整体平移。
      // 否则 edge 的可拖拽段会“留在原地”，表现为只能上下调整、无法左右跟随整体移动。
      const currentNodes = nodesEdgesRef.current.nodes
      const oldById = new Map(currentNodes.map((n) => [n.id, n]))
      
      // Resize（拖拽左上角/边缘把手）时，React Flow 往往会同时发 position + dimensions 变更。
      // 这时不应该平移 edge.waypoints，否则会出现边的折线“诡异变化/抖动”。
      const resizingIds = new Set<string>()
      for (const ch of changes as any[]) {
        if (ch?.type !== 'dimensions') continue
        if (typeof ch.id === 'string') resizingIds.add(ch.id)
      }

      const deltaById = new Map<string, { dx: number; dy: number }>()
      for (const ch of changes as any[]) {
        if (ch?.type !== 'position') continue
        const id = ch.id as string | undefined
        if (!id) continue
        if (resizingIds.has(id)) continue
        const old = oldById.get(id)
        const nextPos = ch.position as { x: number; y: number } | undefined
        if (!old || !nextPos) continue
        const dx = nextPos.x - old.position.x
        const dy = nextPos.y - old.position.y
        if (dx !== 0 || dy !== 0) deltaById.set(id, { dx, dy })
      }
      if (deltaById.size) {
        const groupDeltaById = new Map<string, { dx: number; dy: number }>()
        for (const [id, d] of deltaById) {
          const n = oldById.get(id)
          if (n?.type === 'group') groupDeltaById.set(id, d)
        }

        const isDescendantOf = (nodeId: string, ancestorId: string): boolean => {
          let cur = oldById.get(nodeId)
          const seen = new Set<string>()
          while (cur?.parentId && !seen.has(cur.parentId)) {
            if (cur.parentId === ancestorId) return true
            seen.add(cur.parentId)
            cur = oldById.get(cur.parentId)
          }
          return false
        }

        setEdges((prevEdges) => {
          let changed = false
          const nextEdges = prevEdges.map((e) => {
            // 仅平移“整体一起移动”的边：源和目标节点都在本次移动集合中
            const d1 = deltaById.get(e.source)
            const d2 = deltaById.get(e.target)
            let dx: number | null = null
            let dy: number | null = null
            if (d1 && d2) {
              // 若两端 delta 不一致（理论上多选拖动应一致），以源端为准，避免抖动
              dx = d1.dx
              dy = d1.dy
            } else if (groupDeltaById.size) {
              // 移动群组时：子节点绝对位置会变，但子节点本身 position 不变，导致 waypoints 需要跟随群组 delta 平移
              for (const [gid, gd] of groupDeltaById) {
                const srcIn = e.source === gid || isDescendantOf(e.source, gid)
                const tgtIn = e.target === gid || isDescendantOf(e.target, gid)
                if (srcIn && tgtIn) {
                  dx = gd.dx
                  dy = gd.dy
                  break
                }
              }
            }
            if (dx === null || dy === null) return e
            const dataAny = (e.data ?? {}) as any
            const wps = dataAny.waypoints as Array<{ x: number; y: number }> | undefined
            if (!wps || wps.length === 0) return e
            changed = true
            const moved = wps.map((p) => ({ x: p.x + dx, y: p.y + dy }))
            return { ...e, data: { ...(e.data ?? {}), waypoints: moved } }
          })
          return changed ? nextEdges : prevEdges
        })
      }

      setNodes((prev) => {
        let next = applyNodeChanges(changes, prev)

        // 群组 resize（尤其拖左上角把手）时，React Flow 会改变群组的 position。
        // 为了实现“调整群组大小不影响内部边/节点位置”，需要把群组的位移反向分摊给【直接子节点】，
        // 让子树整体绝对位置不变（只改变群组边框）。注意：不能对所有子孙都反向移动，否则嵌套群组会被重复补偿而错位。
        if (resizingIds.size) {
          const prevById = new Map(prev.map((n) => [n.id, n]))
          const nextById = new Map(next.map((n) => [n.id, n]))

          // 只处理群组节点的 resize
          const groupDeltaById = new Map<string, { dx: number; dy: number }>()
          for (const id of resizingIds) {
            const before = prevById.get(id)
            const after = nextById.get(id)
            if (!before || !after) continue
            if (before.type !== 'group' || after.type !== 'group') continue
            const dx = after.position.x - before.position.x
            const dy = after.position.y - before.position.y
            if (dx !== 0 || dy !== 0) groupDeltaById.set(id, { dx, dy })
          }

          if (groupDeltaById.size) {
            next = next.map((n) => {
              // 只对被 resize 群组的【直接子节点】做反向移动；群组自身保持变更后的 position/dimensions
              const pid = n.parentId
              if (pid && groupDeltaById.has(pid)) {
                const d = groupDeltaById.get(pid)!
                return { ...n, position: { x: n.position.x - d.dx, y: n.position.y - d.dy } }
              }
              return n
            })
          }
        }

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

    // 计算偏移（粘贴时明显偏移，避免与原对象过近导致框选误选）
    const offset = { x: GRID[0] * 10, y: GRID[1] * 10 }

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
    (evt: React.MouseEvent, draggedNode: FlowNode) => {
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

      // 用光标位置表达“是否要拖入画框”的意图：光标在画框内部 => 拖入；光标在父画框外部 => 拖出
      const cursorFlow = rf.screenToFlowPosition({ x: (evt as any).clientX, y: (evt as any).clientY })

      setNodes((nds) => {
        const byId = new Map(nds.map((nd) => [nd.id, nd]))
        const node = byId.get(draggedNode.id)
        if (!node) return nds

        const movedIds = new Set<string>()
        if (node.selected) {
          // 复合拖动：把所有被选中的节点都纳入拖出判定（否则只处理 draggedNode 会残留 parentId）
          for (const n of nds) if (n.selected) movedIds.add(n.id)
        } else {
          movedIds.add(node.id)
        }

        // 光标所在的最合适目标画框（用于“拖出子画框但仍落在父画框内 => 重挂载到父画框”）
        const excludeFramesForCursor = new Set<string>(movedIds)
        const cursorTargetFrame = findBestParentFrame(
          { x: cursorFlow.x, y: cursorFlow.y, width: 0, height: 0 } as any,
          nds as any,
          byId as any,
          excludeFramesForCursor,
        ) as FlowNode | null
        const canAdoptToCursorFrame = cursorTargetFrame && isFrameNode(cursorTargetFrame)
        const cursorFrameAbs = canAdoptToCursorFrame ? getAbsolutePosition(cursorTargetFrame!, byId) : null

        const shouldDetachFromParent = (n: FlowNode): { detach: boolean; absPos: { x: number; y: number } } => {
          const absPos = getAbsolutePosition(n, byId)
          if (!n.parentId) return { detach: false, absPos }
          const parent = byId.get(n.parentId)
          if (!parent) return { detach: true, absPos }
          const pAbs = getAbsolutePosition(parent, byId)
          const pw = getNodeSize(parent).w
          const ph = getNodeSize(parent).h
          const cursorInsideParent =
            cursorFlow.x >= pAbs.x &&
            cursorFlow.x <= pAbs.x + pw &&
            cursorFlow.y >= pAbs.y &&
            cursorFlow.y <= pAbs.y + ph
          return { detach: !cursorInsideParent, absPos }
        }

        const wouldCreateCycle = (childId: string, nextParentId: string): boolean => {
          if (childId === nextParentId) return true
          let cur = byId.get(nextParentId)
          const seen = new Set<string>()
          while (cur?.parentId && !seen.has(cur.parentId)) {
            if (cur.parentId === childId) return true
            seen.add(cur.parentId)
            cur = byId.get(cur.parentId)
          }
          return false
        }

        let changed = false
        let next = nds.map((nd) => {
          if (!movedIds.has(nd.id)) return nd
          if (!nd.parentId) return nd
          const { detach, absPos } = shouldDetachFromParent(nd)
          if (!detach) return nd
          changed = true
          const { parentId: _pid, extent: _extent, ...rest } = nd as any

          // 重要：如果光标落在某个祖先/外层画框内，则直接重挂载到该画框（Figma 行为）
          if (
            canAdoptToCursorFrame &&
            cursorTargetFrame &&
            cursorFrameAbs &&
            !wouldCreateCycle(nd.id, cursorTargetFrame.id)
          ) {
            return {
              ...rest,
              parentId: cursorTargetFrame.id,
              position: { x: absPos.x - cursorFrameAbs.x, y: absPos.y - cursorFrameAbs.y },
            }
          }

          // 否则脱离到根层（全局坐标）
          return { ...rest, parentId: undefined, position: absPos }
        })

        if (changed) {
          next = sortNodesParentFirst(next)
          next = assignZIndex(next)
          pushHistory(next, edges, movedIds.size > 1 ? 'drag-out-multi' : 'drag-out')
          return next
        }

        // 统一的“拖入 Frame”逻辑：适用于拖动普通节点/素材节点/子群组/复合内容。
        // 关键点：只重挂载 movedIds 中的【顶层节点】（其祖先不在 movedIds 中），避免把子孙打散到同一层。
        const all = nds as FlowNode[]
        // 拖入判定时必须排除“本次正在移动的 frame/群组”，否则容易把被拖动的群组自身当成最内层命中的 frame，
        // 导致无法真正挂载进外层画框（你提到的 B/C 编组再拖进 A 的场景）。
        const excludeFramesForDragIn = new Set<string>(movedIds)
        // 以“光标落点”表达用户意图：光标在画框内 => 拖入该画框（Figma 行为）
        const bestFrame = findBestParentFrame(
          { x: cursorFlow.x, y: cursorFlow.y, width: 0, height: 0 } as any,
          all as any,
          byId as any,
          excludeFramesForDragIn,
        ) as FlowNode | null
        if (bestFrame && isFrameNode(bestFrame)) {
          const frameAbs = getAbsolutePosition(bestFrame, byId)
          const frameSize = getNodeSize(bestFrame)
          const frameRect = { x: frameAbs.x, y: frameAbs.y, width: frameSize.w, height: frameSize.h }
          const cursorInsideFrame =
            cursorFlow.x >= frameRect.x &&
            cursorFlow.x <= frameRect.x + frameRect.width &&
            cursorFlow.y >= frameRect.y &&
            cursorFlow.y <= frameRect.y + frameRect.height
          // 光标不在画框内部，则不触发拖入逻辑（避免“松手时元素在框外但仍被挂入/挂不出来”）
          if (!cursorInsideFrame) return nds

          const wouldCreateCycle = (childId: string, nextParentId: string): boolean => {
            let cur = byId.get(nextParentId)
            const seen = new Set<string>()
            while (cur?.parentId && !seen.has(cur.parentId)) {
              if (cur.parentId === childId) return true
              seen.add(cur.parentId)
              cur = byId.get(cur.parentId)
            }
            return nextParentId === childId
          }

          const isTopLevelMoved = (id: string): boolean => {
            let cur = byId.get(id)
            const seen = new Set<string>()
            while (cur?.parentId && !seen.has(cur.parentId)) {
              if (movedIds.has(cur.parentId)) return false
              seen.add(cur.parentId)
              cur = byId.get(cur.parentId)
            }
            return true
          }

          const movedTopSet = new Set([...movedIds].filter(isTopLevelMoved))

          const absCache = new Map<string, { x: number; y: number }>()
          const getAbs = (n: FlowNode) => {
            const cached = absCache.get(n.id)
            if (cached) return cached
            const v = getAbsolutePosition(n, byId)
            absCache.set(n.id, v)
            return v
          }

          let changedIn = false
          let nextIn = nds.map((nd) => {
            if (!movedTopSet.has(nd.id)) return nd
            if (nd.id === bestFrame.id) return nd
            if (wouldCreateCycle(nd.id, bestFrame.id)) return nd

            const abs = getAbs(nd)
            // 已经用 cursorInsideFrame 表达意图，这里不要再用“节点中心点是否在框内”做二次过滤：
            // 画框很大/只拖进去一部分时，中心点可能仍在外侧，会导致“拖进画框却不成为子集”

            // 若已经在该 frame 下且 position 已是局部坐标，保持不动
            if (nd.parentId === bestFrame.id) return nd

            changedIn = true
            return {
              ...nd,
              parentId: bestFrame.id,
              // 只建立真实父子关系（局部坐标系）；不要用 extent 约束，否则会无法拖出画框
              position: { x: abs.x - frameRect.x, y: abs.y - frameRect.y },
            } as any
          })

          if (changedIn) {
            // Swimlane: 同步 laneId（拖入 lane 时写入 data.laneId，拖入非 lane frame 时清除）
            nextIn = nextIn.map((nd) => {
              if (!nd.parentId) return nd
              const parent = byId.get(nd.parentId) ?? nextIn.find((n) => n.id === nd.parentId)
              if (!parent) return nd
              const isLane = (parent.data as any)?.role === 'lane'
              if (isLane && (nd.data as any)?.laneId !== nd.parentId) {
                return { ...nd, data: { ...(nd.data ?? {}), laneId: nd.parentId } }
              }
              if (!isLane && (nd.data as any)?.laneId) {
                const { laneId: _, ...restData } = nd.data as any
                return { ...nd, data: restData }
              }
              return nd
            })
            nextIn = sortNodesParentFirst(nextIn)
            nextIn = assignZIndex(nextIn)
            pushHistory(nextIn, edges, movedTopSet.size > 1 ? 'drag-in-multi' : 'drag-in')
            return nextIn
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

  /** 在画布指定位置添加节点（由右键菜单「添加节点/添加文本」调用）；尽量选不重叠位置，减少框选误选 */
  const addNodeAtPosition = useCallback(
    (nodeType: 'quad' | 'text', flowPos: { x: number; y: number }) => {
      const id = nowId('n')
      const defaultSize = nodeType === 'quad' ? { w: 160, h: 44 } : { w: 60, h: 28 }
      const currentNodes = nodesEdgesRef.current.nodes
      const position = findNonOverlappingPosition(flowPos, currentNodes, defaultSize.w, defaultSize.h)
      const base: FlowNode = {
        id,
        type: nodeType,
        position,
        // Set initial size explicitly.
        // Otherwise QuadNode/ReactFlow will fall back to DOM min-width (currently 80px),
        // which makes newly created nodes start at 80px instead of the intended 160px.
        width: defaultSize.w,
        height: defaultSize.h,
        style: { width: defaultSize.w, height: defaultSize.h },
        // 文本节点空标签：立即进入编辑态，并由 TextNode 按内容自适应宽高（类 Figma）
        data: { label: nodeType === 'quad' ? `节点 ${id.slice(-4)}` : '' },
      }
      setNodes((nds) => {
        const next = nds.concat(base)
        pushHistory(next, edges, 'add')
        return next
      })
    },
    [edges, findNonOverlappingPosition, pushHistory, setNodes],
  )

  /** 新增画框（Frame）：本质是一个空的 group 节点（中等大小），用于承载任意子节点 */
  const addFrameAtPosition = useCallback(
    (flowPos: { x: number; y: number }) => {
      const id = nowId('g')
      const w = 640
      const h = 420
      // 让鼠标点落在 frame 的左上内侧一点，符合 figma “创建 frame” 的直觉
      const pos = snapPos({ x: flowPos.x - 24, y: flowPos.y - 24 })
      const frameNode: FlowNode = {
        id,
        type: 'group',
        position: pos,
        width: w,
        height: h,
        data: {
          title: '画框',
          stroke: '#e2e8f0',
          fill: 'rgba(226, 232, 240, 0.20)',
          titleFontSize: 14,
          titleColor: '#64748b',
          // 预留：后续可扩展 frame 的 padding/header/overflow 等
          role: 'frame',
        } as any,
        draggable: true,
        style: { width: w, height: h },
      }
      setNodes((nds) => {
        const next = nds.concat(frameNode)
        pushHistory(next, edges, 'add-frame')
        return next
      })
    },
    [edges, pushHistory, setNodes, snapPos],
  )

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
        // Explicit default sizing for consistent initial width.
        width: nodeType === 'quad' ? 160 : nodeType === 'text' ? 60 : undefined,
        height: nodeType === 'quad' ? 44 : nodeType === 'text' ? 28 : undefined,
        style:
          nodeType === 'quad'
            ? { width: 160, height: 44 }
            : nodeType === 'text'
              ? { width: 60, height: 28 }
              : undefined,
        data: { label: nodeType === 'text' ? '' : `${nodeType} ${id.slice(-4)}` },
      }

      setNodes((nds) => {
        const next = nds.concat(base)
        pushHistory(next, edges, 'drop')
        return next
      })
    },
    [edges, pushHistory, rf, snapPos],
  )

  /** 按 edgeId 更新边（供 EdgeEditPopup 使用，不依赖当前选中） */
  const updateEdgeById = useCallback(
    (edgeId: string, patch: Partial<FlowEdge>) => {
      setEdges((eds) => eds.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)))
    },
    [setEdges],
  )

  // Open save modal with pre-filled filename
  const openSaveModal = useCallback(() => {
    setExportFileName(fileName || 'Flow2Go')
    setSaveModalOpen(true)
  }, [fileName])

  // 实际执行导出：打一个 zip，包含 project.json + assets 文件夹
  const confirmExport = useCallback(async () => {
    const safeName = (exportFileName || 'flow2go').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
    const zip = new JSZip()

    const manifest = {
      version: 1,
      exportedAt: Date.now(),
      name: exportFileName,
      nodes,
      edges,
      viewport: rf.getViewport(),
      assets: assets.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        fileName: `${a.id}.${a.type === 'svg' ? 'svg' : 'png'}`,
        path: `assets/${a.id}.${a.type === 'svg' ? 'svg' : 'png'}`,
      })),
    }
    zip.file('project.json', JSON.stringify(manifest, null, 2))

    const assetsFolder = zip.folder('assets')
    if (assetsFolder) {
      for (const a of assets) {
        try {
          const res = await fetch(a.dataUrl)
          const blob = await res.blob()
          const arrayBuffer = await blob.arrayBuffer()
          assetsFolder.file(
            `${a.id}.${a.type === 'svg' ? 'svg' : 'png'}`,
            arrayBuffer,
          )
        } catch {
          // 忽略单个素材失败
        }
      }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    // 标记为已保存
    setHasUnsavedChanges(false)
    setSaveModalOpen(false)

    // 如果用户改了文件名，同步更新项目名
    if (exportFileName !== fileName) {
      setFileName(exportFileName)
      const proj = getProject(projectId)
      if (proj) {
        proj.name = exportFileName.trim() || 'untitled'
        proj.updatedAt = Date.now()
        saveProject(proj)
      }
    }
  }, [assets, edges, exportFileName, fileName, nodes, projectId, rf])

  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
        const zip = await JSZip.loadAsync(file)
        const manifestFile = zip.file('project.json')
        if (!manifestFile) return
        const manifestText = await manifestFile.async('string')
        const parsed = JSON.parse(manifestText) as {
          name?: string
          nodes?: FlowNode[]
          edges?: FlowEdge[]
          viewport?: { x: number; y: number; zoom: number }
          assets?: {
            id: string
            name: string
            type: 'svg' | 'png'
            fileName: string
            path: string
          }[]
        }
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return

        // 先还原边和节点
        const nextNodes = parsed.nodes
        const nextEdges = parsed.edges.map((e) => ({ ...e, type: (e.type ?? 'bezier') as any }))
        setNodes(nextNodes)
        setEdges(nextEdges)
        if (parsed.viewport) rf.setViewport(parsed.viewport, { duration: 0 })
        pushHistory(nextNodes, nextEdges, 'import')

        // 项目名
        if (parsed.name) {
          setFileName(parsed.name)
        }

        // 还原素材：从 zip 里读出 assets 文件夹，转回 dataUrl，合并进素材库
        if (Array.isArray(parsed.assets) && parsed.assets.length > 0) {
          const restored: AssetItem[] = []
          for (const a of parsed.assets) {
            const f = zip.file(a.path) || zip.file(a.fileName) || zip.file(`assets/${a.fileName}`)
            if (!f) continue
            const blob = await f.async('blob')
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as string)
              reader.readAsDataURL(blob)
            })
            restored.push({
              id: a.id,
              name: a.name,
              type: a.type,
              dataUrl,
            })
          }
          if (restored.length > 0) {
            setAssets((prev) => {
              const existingIds = new Set(prev.map((x) => x.id))
              const incoming = restored.filter((x) => !existingIds.has(x.id))
              return [...prev, ...incoming]
            })
          }
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

  // AI 弹窗：不按遮罩关闭（避免误触）；生成中也不响应 Esc，防止半途中断
  useEffect(() => {
    if (!aiModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !aiModalGenerating) {
        e.preventDefault()
        setAiModalOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aiModalOpen, aiModalGenerating])

  // ---------- Helpers: grouping ----------

  const groupSelection = useCallback(() => {
    // 至少选 1 个节点；选 2 个及以上时打包成群组，只选 1 个时仅当该节点是群组才允许（包装为“第三层群组”等）
    if (selectedNodesNow.length < 1) return

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
    if (picked.length < 1) return
    // 只选一个且不是群组时不允许建群（无法“包装”）
    if (picked.length === 1 && !isGroupNode(picked[0])) return

    const absMap = new Map<string, { x: number; y: number }>()
    for (const n of picked) absMap.set(n.id, getAbsolutePosition(n, byId))

    // 对每个选中项算「自身 + 若是群组则含所有子孙」的绝对边界，避免两层群组时只用群组自身 160×120 导致新群组错位/跑到画布中间
    const getAbsoluteBounds = (node: FlowNode): { minX: number; minY: number; maxX: number; maxY: number } => {
      const pos = absMap.get(node.id) ?? getAbsolutePosition(node, byId)
      const { w, h } = getNodeSize(node)
      let minX = pos.x
      let minY = pos.y
      let maxX = pos.x + w
      let maxY = pos.y + h
      if (isGroupNode(node)) {
        const children = nodes.filter((nd) => nd.parentId === node.id)
        for (const c of children) {
          const cb = getAbsoluteBounds(c)
          minX = Math.min(minX, cb.minX)
          minY = Math.min(minY, cb.minY)
          maxX = Math.max(maxX, cb.maxX)
          maxY = Math.max(maxY, cb.maxY)
        }
      }
      return { minX, minY, maxX, maxY }
    }

    // 先用节点（含子孙）的绝对边界作为基础 bounds
    let bounds = picked.reduce(
      (acc, n) => {
        const b = getAbsoluteBounds(n)
        acc.minX = Math.min(acc.minX, b.minX)
        acc.minY = Math.min(acc.minY, b.minY)
        acc.maxX = Math.max(acc.maxX, b.maxX)
        acc.maxY = Math.max(acc.maxY, b.maxY)
        return acc
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    )

    // 把“群组内相关边”的路径也纳入 bounds（至少包含用户拖拽出来的 waypoints）
    // 这样建群组时容器边缘能把边也包住。
    const childIds = new Set<string>()
    const byParent = new Map<string, FlowNode[]>()
    for (const nd of nodes) {
      if (!nd.parentId) continue
      const arr = byParent.get(nd.parentId) ?? []
      arr.push(nd)
      byParent.set(nd.parentId, arr)
    }
    const collect = (id: string) => {
      if (childIds.has(id)) return
      childIds.add(id)
      const kids = byParent.get(id)
      if (!kids) return
      for (const k of kids) collect(k.id)
    }
    for (const n of picked) collect(n.id)

    const relatedEdges = edges.filter((e) => childIds.has(e.source) && childIds.has(e.target))
    let hasEdgeGeometry = false
    for (const e of relatedEdges) {
      const wps = ((e.data ?? {}) as any)?.waypoints as Array<{ x: number; y: number }> | undefined
      if (!wps || wps.length === 0) continue
      hasEdgeGeometry = true
      for (const p of wps) {
        bounds.minX = Math.min(bounds.minX, p.x)
        bounds.minY = Math.min(bounds.minY, p.y)
        bounds.maxX = Math.max(bounds.maxX, p.x)
        bounds.maxY = Math.max(bounds.maxY, p.y)
      }
    }
    // 正交边在端口外有 EDGE_HANDLE_GAP_PX 间隙 + 路由外扩（EditableSmoothStepEdge 默认 24），留安全 padding 包住边
    if (relatedEdges.length > 0) {
      const pad = hasEdgeGeometry ? 24 : 32
      bounds = {
        minX: bounds.minX - pad,
        minY: bounds.minY - pad,
        maxX: bounds.maxX + pad,
        maxY: bounds.maxY + pad,
      }
    }

    const groupId = nowId('g')
    const title = `群组 ${groupId.slice(-4)}`
    const titleH = title.trim() ? GROUP_TITLE_H : 0

    // 计算 commonParentId 时，必须排除“父节点也在 picked 里”的情况，
    // 否则会出现：新群组 parentId=父群组，但父群组又被 reparent 到新群组下面 -> 层级循环，表现为跳走/无法拖动
    const pickedIds = new Set(picked.map((n) => n.id))
    const parents = new Set(
      picked
        .map((n) => n.parentId)
        .filter((pid): pid is string => Boolean(pid) && !pickedIds.has(pid as string)),
    )
    const commonParentId = parents.size === 1 ? [...parents][0] : undefined

    const groupAbsX = bounds.minX - GROUP_PADDING
    const groupAbsY = bounds.minY - GROUP_PADDING - titleH
    const groupW = bounds.maxX - bounds.minX + GROUP_PADDING * 2
    const groupH = bounds.maxY - bounds.minY + GROUP_PADDING * 2 + titleH

    let groupPos: { x: number; y: number }
    let effectiveParentId: string | undefined = commonParentId
    if (commonParentId) {
      const pp = byId.get(commonParentId)
      if (pp) {
        const ppAbs = getAbsolutePosition(pp, byId)
        groupPos = { x: groupAbsX - ppAbs.x, y: groupAbsY - ppAbs.y }
      } else {
        effectiveParentId = undefined
        groupPos = { x: groupAbsX, y: groupAbsY }
      }
    } else {
      groupPos = { x: groupAbsX, y: groupAbsY }
    }

    const groupNode: FlowNode = {
      id: groupId,
      type: 'group',
      position: groupPos,
      ...(effectiveParentId ? { parentId: effectiveParentId } : {}),
      width: groupW,
      height: groupH,
      data: {
        title,
        stroke: '#3b82f6',
        strokeWidth: 1,
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
      pushHistory(next, edges, 'group')
      return next
    })
  }, [assignZIndex, edges, getAbsolutePosition, getNodeSize, isGroupNode, nodes, pushHistory, selectedNodesNow, sortNodesParentFirst])

  const updateGroupStyle = useCallback(
    (groupId: string, patch: Partial<GroupNodeData>) => {
      setNodes((nds) => {
        const next = nds.map((n) => (n.id === groupId ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n))
        pushHistory(next, edges, 'group-style')
        return next
      })
    },
    [edges, pushHistory],
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

  // 已移除快速对齐功能（左/右/居中/顶/底/等间距等），避免错误对齐导致布局错乱

  const runLayout = useCallback(
    (dir: LayoutDirection) => {
      const picked = selectedNodesNow
      const edgesNow = edges
      if (picked.length < 2) return

      void (async () => {
        const pickedIds = new Set(picked.map((n) => n.id))
        const subEdges = edgesNow.filter((e) => pickedIds.has(e.source) && pickedIds.has(e.target))

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

        const laid = await autoLayout(picked, subEdges, dir)
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
          pushHistory(next, edgesNow, `layout:${dir}`)
          return next
        })
      })()
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

  const deleteFrameKeepContents = useCallback(
    (frameId: string) => {
      setNodes((nds) => {
        const byId = new Map(nds.map((nd) => [nd.id, nd]))
        const frame = byId.get(frameId)
        if (!frame) return nds

        const newParentId = frame.parentId
        const newParent = newParentId ? byId.get(newParentId) : undefined
        const newParentAbs = newParent ? getAbsolutePosition(newParent, byId) : null

        let next = nds.map((n) => {
          if (n.parentId !== frameId) return n
          const absPos = getAbsolutePosition(n, byId)
          if (newParentId && newParentAbs) {
            return {
              ...n,
              parentId: newParentId,
              position: { x: absPos.x - newParentAbs.x, y: absPos.y - newParentAbs.y },
            }
          }
          return { ...n, parentId: undefined, position: absPos }
        })

        next = next.filter((n) => n.id !== frameId)
        next = sortNodesParentFirst(next)
        pushHistory(next, edges, 'del-frame-keep')
        return next
      })
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

  // 框选时会出现 selection-rect 覆盖层，可能吃掉右键事件；这里用 capture 阶段兜底。右击空白画布打开画布菜单；右击在节点/边上时不处理，交给 onNodeContextMenu/onEdgeContextMenu，才能显示「前移一层/后移一层」等。
  const onCanvasContextMenuCapture = useCallback(
    (evt: React.MouseEvent) => {
      const el = evt.target as Element | null
      if (el?.closest?.('.react-flow__node') || el?.closest?.('.react-flow__edge')) return
      evt.preventDefault()
      evt.stopPropagation()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = evt.clientX - rect.left
      const y = evt.clientY - rect.top
      const flowPos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
      setMenu({ open: true, x, y, clientX: evt.clientX, clientY: evt.clientY, kind: 'pane', flowPos })
    },
    [rf],
  )

  const onNodeContextMenu = useCallback(
    (evt: MouseEvent | React.MouseEvent, node: FlowNode) => {
      if (textEditLock) return
      ;(evt as any).preventDefault?.()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (evt as any).clientX - rect.left
      const y = (evt as any).clientY - rect.top
      const cx = (evt as any).clientX
      const cy = (evt as any).clientY
      const flowPos = rf.screenToFlowPosition({ x: cx, y: cy })
      // 多选时，右击任意已选节点也弹出“多选菜单”（包含群组/对齐等），避免只能看到单节点菜单导致“群组选项没了”
      const hasMultiSelection = selectedNodesNow.length >= 2 || selectedEdgesNow.length >= 1
      if (hasMultiSelection && node.selected) {
        setMenu({ open: true, x, y, clientX: cx, clientY: cy, kind: 'pane', flowPos })
        return
      }
      setMenu({ open: true, x, y, clientX: cx, clientY: cy, kind: 'node', nodeId: node.id, nodeType: node.type, flowPos })
    },
    [rf, selectedEdgesNow.length, selectedNodesNow],
  )

  const onEdgeContextMenu = useCallback(
    (evt: MouseEvent | React.MouseEvent, edge: FlowEdge) => {
      if (textEditLock) return
      ;(evt as any).preventDefault?.()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = (evt as any).clientX - rect.left
      const y = (evt as any).clientY - rect.top
      const cx = (evt as any).clientX
      const cy = (evt as any).clientY
      const flowPos = rf.screenToFlowPosition({ x: cx, y: cy })
      // 多选时，右击任意已选边也弹出“多选菜单”（包含群组/对齐等）
      const hasMultiSelection = selectedNodesNow.length >= 2 || selectedEdgesNow.length >= 1
      if (hasMultiSelection && edge.selected) {
        setMenu({ open: true, x, y, clientX: cx, clientY: cy, kind: 'pane', flowPos })
        return
      }
      setMenu({ open: true, x, y, clientX: cx, clientY: cy, kind: 'edge', edgeId: edge.id, flowPos })
    },
    [rf, selectedEdgesNow.length, selectedNodesNow],
  )

  // 用于区分“单击边打开菜单”和“双击边编辑文字”
  const edgeClickTimerRef = useRef<number | null>(null)
  const edgeLastDoubleClickAtRef = useRef<number>(0)

  const onEdgeDoubleClick = useCallback(
    (evt: React.MouseEvent, edge: FlowEdge) => {
      evt.stopPropagation()
      edgeLastDoubleClickAtRef.current = Date.now()
      // 双击时只保留文字编辑工具条：关闭边菜单/其它浮层，并取消可能的单击延迟打开
      if (edgeClickTimerRef.current) {
        window.clearTimeout(edgeClickTimerRef.current)
        edgeClickTimerRef.current = null
      }
      setEdgePopup(null)
      setShapePopup(null)
      setInlineInspector({ kind: null, id: null, x: 0, y: 0 })
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

  /** 单击节点时：quad 或 group 弹出对应属性工具栏；popup 在节点上方居中、间距 8px。编组内节点用 store 中的 positionAbsolute 才能得到正确屏幕坐标 */
  const onNodeClick = useCallback(
    (_evt: React.MouseEvent, node: FlowNode) => {
      if (textEditLock) return
      if (node.type !== 'quad' && node.type !== 'group' && node.type !== 'asset') return
      setEdgePopup(null)
      const state = storeApi.getState()
      const internalNode = state.nodeLookup.get(node.id)
      const positionAbsolute = (internalNode as { internals?: { positionAbsolute?: { x: number; y: number } } } | undefined)?.internals?.positionAbsolute
      const pos = positionAbsolute ?? node.position
      const topLeft = rf.flowToScreenPosition(pos)
      const w = (node.measured as { width?: number })?.width ?? (node as { width?: number }).width ?? (node.style as { width?: number })?.width ?? 160
      const centerX = topLeft.x + Number(w) / 2
      const top = topLeft.y
      setShapePopup({ nodeId: node.id, x: centerX, y: top - 8 })
    },
    [rf, storeApi, textEditLock],
  )

  /** 单击边时：弹出边属性 popup，在点击位置上方 8px 居中 */
  const onEdgeClick = useCallback((evt: React.MouseEvent, edge: FlowEdge) => {
    if (textEditLock) return
    // 双击链路中 React 仍可能触发 click；或用户慢双击导致 click 定时器抢先弹出。
    // 规则：双击期间/双击后短窗口内，绝不弹出边属性菜单；编辑文字期间也绝不弹出。
    if (evt.detail >= 2) return
    if ((edge.data as any)?.editingLabel) return
    if (Date.now() - edgeLastDoubleClickAtRef.current < 420) return

    setShapePopup(null)
    if (edgeClickTimerRef.current) {
      window.clearTimeout(edgeClickTimerRef.current)
      edgeClickTimerRef.current = null
    }
    // 延迟打开：若紧接着发生双击，会在 onEdgeDoubleClick 中取消
    const cx = evt.clientX
    const cy = evt.clientY
    edgeClickTimerRef.current = window.setTimeout(() => {
      // 定时器触发时再次检查：若已进入文字编辑（双击成功），不弹出边属性菜单
      const nowEdge = nodesEdgesRef.current.edges.find((e) => e.id === edge.id) as any
      if (nowEdge?.data?.editingLabel) {
        edgeClickTimerRef.current = null
        return
      }
      setEdgePopup({ edgeId: edge.id, x: cx, y: cy - 8 })
      edgeClickTimerRef.current = null
    }, 260)
  }, [textEditLock])


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

  const edgeTypes = useMemo(
    () => ({ smoothstep: EditableSmoothStepEdge, bezier: EditableBezierEdge }),
    [],
  )

  // ---------- Shortcuts（放在所有动作定义之后，避免 TDZ） ----------
  useEffect(() => {
    const hasTextSelectionToCopy = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return false
      return sel.toString().length > 0
    }

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
        // 画布上划选了节点标题等文本时，应走系统复制，不要被「复制选中节点」劫持
        if (hasTextSelectionToCopy()) return
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
        const canGroup =
          selectedNodesNow.length >= 2 ||
          (selectedNodesNow.length === 1 && isGroupNode(selectedNodesNow[0]))
        if (canGroup) {
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
      {!isPreview && assetsPopupOpen && (
        <Sidebar
          assets={assets}
          onAddAsset={onAddAsset}
          onDeleteAsset={onDeleteAsset}
          onAddAiAsset={onAddAiAsset}
          aiDiagramDraft={aiDiagramDraft}
          fileName={fileName}
          onRenameFile={onRenameFile}
          onBackHome={onBackHome ? handleBackHome : undefined}
          containerClassName={styles.assetsPopup}
        />
      )}

      <main
        ref={canvasRef}
        className={styles.canvas}
        data-space-pan={spacePressed ? true : undefined}
        onContextMenuCapture={onCanvasContextMenuCapture}
      >
        <ReactFlow
          nodes={nodesForFlow}
          edges={edges}
          nodeOrigin={[0, 0]}
          onNodesChange={isPreview ? undefined : onNodesChange}
          onEdgesChange={isPreview ? undefined : onEdgesChange}
          onConnect={isPreview ? undefined : onConnect}
          onSelectionChange={isPreview ? undefined : onSelectionChange}
          onNodeDragStart={isPreview ? undefined : onNodeDragStart}
          onNodeDragStop={isPreview ? undefined : onNodeDragStop}
          onDrop={isPreview ? undefined : onDrop}
          onDragOver={isPreview ? undefined : onDragOver}
          onPaneContextMenu={isPreview ? undefined : onPaneContextMenu}
          onNodeClick={isPreview ? undefined : onNodeClick}
          onNodeContextMenu={isPreview ? undefined : onNodeContextMenu}
          onEdgeClick={isPreview ? undefined : onEdgeClick}
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
          // 触摸板/滚轮体验：
          // - 开启 preventScrolling 避免页面滚动/浏览器手势抢事件
          // - 开启 zoomOnScroll：Mac 触摸板 pinch 往往以 wheel+ctrlKey 形式触发；只开 zoomOnPinch 在部分环境会失效
          preventScrolling
          zoomOnScroll
          zoomOnPinch
          snapToGrid={!isPreview}
          snapGrid={GRID}
          nodeTypes={nodeTypesFull}
          edgeTypes={edgeTypes}
          nodesDraggable={isPreview ? false : !spacePressed}
          nodesConnectable={isPreview ? false : !spacePressed}
          elementsSelectable={isPreview ? false : !spacePressed}
          defaultEdgeOptions={{
            type: 'bezier',
            style: { stroke: DEFAULT_EDGE_COLOR, strokeWidth: 2 },
            markerEnd: { ...DEFAULT_MARKER_END },
          }}
          proOptions={{ hideAttribution: true }}
        >
          <EdgeLabelLayoutProvider>
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <MiniMap zoomable pannable />
            <Controls />

            {!isPreview && (
            <Panel position="top-right" className={styles.topPanel}>
              <button
                className={styles.assetsBtn}
                type="button"
                onClick={() => {
                  setAiModalError(null)
                  setAiConfigOpen(false)
                  setAiModalPrompt('')
                  setAiModalScene(null)
                  setAiModalOpen(true)
                }}
              >
                AI生成
              </button>
              <button
                className={styles.assetsBtn}
                type="button"
                onClick={() => setAssetsPopupOpen((v) => !v)}
              >
                素材
              </button>
              <button
                className={styles.assetsBtn}
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                导入
              </button>
              <button
                className={styles.assetsBtn}
                type="button"
                onClick={openSaveModal}
                title="导出 zip（project.json + assets）"
              >
                保存
              </button>
            </Panel>
            )}
          </EdgeLabelLayoutProvider>
        </ReactFlow>

        {aiModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(203, 203, 203, 0.5)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              zIndex: 30000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                maxHeight: '90vh',
                width: 'min(760px, 94vw)',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 14,
                boxShadow: '0 24px 60px rgba(15,23,42,0.18)',
                color: '#0f172a',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>AI 生成</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className={styles.aiConfigIconBtn}
                    title="OpenRouter 配置"
                    onClick={() => setAiConfigOpen((v) => !v)}
                  >
                    <Settings2 size={16} />
                  </button>
                  <button type="button" className={styles.aiCloseIconBtn} title="关闭" onClick={() => setAiModalOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className={styles.aiModalLayout}>
                {aiConfigOpen && (
                  <div className={styles.aiConfigPanel}>
                    <div className={styles.aiConfigTitle}>OpenRouter 配置</div>
                    <input
                      className={styles.aiApiKeyInput}
                      value={aiModalKey}
                      onChange={(e) => {
                        setAiModalKey(e.target.value)
                        try { localStorage.setItem('flow2go-openrouter-key', e.target.value) } catch {}
                      }}
                      placeholder="sk-or-..."
                    />
                    <input
                      className={styles.aiApiKeyInput}
                      value={aiModalModel}
                      onChange={(e) => {
                        setAiModalModel(e.target.value)
                        try { localStorage.setItem('flow2go-openrouter-model', e.target.value) } catch {}
                      }}
                      placeholder="openai/gpt-5.4-nano"
                    />
                    <div className={styles.aiNote} style={{ opacity: 0.9 }}>
                      配置只保存在本地浏览器。未配置 Key 时，无法发起生成。
                    </div>
                  </div>
                )}

                <div className={styles.aiPromptColumn}>
                  <div className={styles.aiPromptHeader}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#334155' }}>Prompt</div>
                    {!aiModalKey.trim() && (
                      <button type="button" className={styles.aiNeedConfigTag} onClick={() => setAiConfigOpen(true)}>
                        <KeyRound size={14} />
                        需先配置 API Key
                      </button>
                    )}
                  </div>
                  <div className={styles.aiChatInputWrap}>
                    <textarea
                      value={aiModalPrompt}
                      onChange={(e) => setAiModalPrompt(e.target.value)}
                      rows={10}
                      placeholder="输入你的需求，支持多层级描述…"
                      className={styles.aiChatInput}
                    />
                  </div>
                  <AiSceneCapsules
                    presets={AI_SCENE_CAPSULE_PRESETS}
                    selectedScene={aiModalScene}
                    disabled={aiModalGenerating}
                    onSelect={(preset) => {
                      setAiModalScene(preset.scene)
                      // 已有输入时只锁定生图场景，不覆盖用户文案；空内容时才预填模板
                      setAiModalPrompt((prev) => (prev.trim() ? prev : preset.prompt))
                    }}
                    onClearScene={() => {
                      setAiModalScene(null)
                      setAiModalPrompt('')
                    }}
                  />
                  {aiModalError && <div className={styles.aiError}>{aiModalError}</div>}

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={styles.aiGenerateBtn}
                      disabled={aiModalGenerating || !aiModalPrompt.trim()}
                      onClick={async () => {
                        const p = aiModalPrompt.trim()
                        if (!p) return
                        if (aiModalScene !== 'swimlane' && !aiModalKey.trim()) {
                          setAiModalError('请先填写 OpenRouter API Key')
                          setAiConfigOpen(true)
                          return
                        }
                        setAiModalGenerating(true)
                        setAiModalError(null)
                        setAiModalProgress({ phase: '已提交', detail: '等待 OpenRouter…' })
                        try {
                          // Swimlane 独立链路：不走 LLM，直接用 SwimlaneDraft -> GraphBatchPayload
                          if (aiModalScene === 'swimlane') {
                            setAiModalProgress({ phase: '生成泳道图', detail: '解析中…' })
                            const { buildSwimlaneDraftFromPrompt, swimlaneDraftToGraphBatchPayload } = await import('./swimlaneDraft')
                            const { materializeGraphBatchPayloadToSnapshot } = await import('./mermaid/apply')
                            const draftFromPrompt = buildSwimlaneDraftFromPrompt(p)
                            const payload = swimlaneDraftToGraphBatchPayload(draftFromPrompt)
                            const snap = await materializeGraphBatchPayloadToSnapshot(payload)
                            const nextNodes = (snap.nodes ?? []) as FlowNode[]
                            const nextEdges = (snap.edges ?? []) as FlowEdge[]
                            setNodes(nextNodes)
                            setEdges(nextEdges)
                            pushHistory(nextNodes, nextEdges, 'ai-swimlane')
                            setAiModalOpen(false)
                            setAiModalGenerating(false)
                            setAiModalProgress(null)
                            return
                          }
                          const ac = new AbortController()
                          aiModalAbortRef.current = ac
                          const draft = await openRouterGenerateDiagram({
                            apiKey: aiModalKey.trim(),
                            model: aiModalModel.trim() || 'openai/gpt-5.4-nano',
                            prompt: p,
                            signal: ac.signal,
                            diagramScene: aiModalScene ?? undefined,
                            onProgress: (info: AiGenerateProgressInfo) => {
                              setAiModalProgress({ phase: info.phase, detail: info.detail })
                            },
                          })
                          setAiDiagramDraft(draft)
                          applyAiDraftDirect(draft)
                          setAiModalOpen(false)
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : '生成失败'
                          if (msg.includes('用户已取消')) {
                            setAiModalError('已取消本次生成')
                          } else if (msg.includes('请求超时')) {
                            setAiModalError(`${msg}。系统已做超时兜底重试，建议减少描述冗余后再试。`)
                          } else {
                            setAiModalError(msg)
                          }
                        } finally {
                          aiModalAbortRef.current = null
                          setAiModalGenerating(false)
                          setAiModalProgress(null)
                        }
                      }}
                    >
                      {aiModalGenerating ? '生成中…' : '生成并应用'}
                    </button>
                  </div>

                  {aiModalGenerating && (
                    <div className={styles.aiGenProgress}>
                      <div className={styles.aiGenProgressHead}>
                        <div className={styles.aiGenProgressPhase}>{aiModalProgress?.phase ?? '准备中…'}</div>
                        {String(aiModalProgress?.phase ?? '').includes('大模型生成 Mermaid') ? (
                          <button
                            type="button"
                            className={styles.aiCancelBtn}
                            onClick={() => {
                              aiModalAbortRef.current?.abort()
                            }}
                          >
                            取消生成
                          </button>
                        ) : null}
                      </div>
                      {aiModalProgress?.detail ? (
                        <div className={styles.aiGenProgressDetail}>{aiModalProgress.detail}</div>
                      ) : null}
                      <div className={styles.aiGenProgressHint}>
                        已等待 {aiGenElapsedSec}s · 按 F12 打开开发者工具，在 Console 中搜索{' '}
                        <code>[Flow2Go AI]</code> 可查看每步耗时。若某一步长时间不变，多为 API 慢或排队，不是页面卡死。
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {menu.open && (
          <div
            ref={menuRef}
            className={styles.menu}
            style={menuFixedPos ? { left: menuFixedPos.left, top: menuFixedPos.top } : { left: menu.clientX, top: menu.clientY }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.kind === 'pane' && selectedNodesNow.length === 0 && selectedEdgesNow.length === 0 && (
              <>
                <button
                  className={styles.menuItem}
                  type="button"
                  onClick={() => {
                    addNodeAtPosition('quad', menu.flowPos)
                    closeMenu()
                  }}
                >
                  <span className={styles.menuLabel}>
                    <span className={styles.menuIcon}>
                      <Square size={14} />
                    </span>
                    <span>添加节点</span>
                  </span>
                  <span className={styles.menuKbd}></span>
                </button>
                <button
                  className={styles.menuItem}
                  type="button"
                  onClick={() => {
                    addFrameAtPosition(menu.flowPos)
                    closeMenu()
                  }}
                >
                  <span className={styles.menuLabel}>
                    <span className={styles.menuIcon}>
                      <InspectionPanel size={14} />
                    </span>
                    <span>新增画框</span>
                  </span>
                  <span className={styles.menuKbd}></span>
                </button>
                <button
                  className={styles.menuItem}
                  type="button"
                  onClick={() => {
                    addNodeAtPosition('text', menu.flowPos)
                    closeMenu()
                  }}
                >
                  <span className={styles.menuLabel}>
                    <span className={styles.menuIcon}>
                      <Type size={14} />
                    </span>
                    <span>添加文本</span>
                  </span>
                  <span className={styles.menuKbd}></span>
                </button>
              </>
            )}
            {menu.kind === 'pane' &&
              (selectedNodesNow.length >= 2 ||
                (selectedNodesNow.length === 1 && isGroupNode(selectedNodesNow[0]))) && (
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
                {/* 已移除快速对齐功能（左/右/居中/顶/底/等间距等） */}
                <button className={styles.menuItemDanger} type="button" onClick={() => (deleteSelection(), closeMenu())}>
                  <span>删除</span>
                  <span className={styles.menuKbd}>Del</span>
                </button>
              </>
            )}
            {menu.kind === 'node' && (
              <>
                <button
                  className={styles.menuItem}
                  type="button"
                  onClick={() => (menu.nodeId ? duplicateNode(menu.nodeId) : undefined, closeMenu())}
                >
                  <span>复制节点</span>
                  <span className={styles.menuKbd}>Ctrl/Cmd+D</span>
                </button>
                <button
                  className={styles.menuItemDanger}
                  type="button"
                  onClick={() => (menu.nodeId ? deleteNode(menu.nodeId) : undefined, closeMenu())}
                >
                  <span>删除节点</span>
                  <span className={styles.menuKbd}>Del</span>
                </button>
                <button
                  className={styles.menuItem}
                  type="button"
                  onClick={() => (menu.nodeId ? moveNodeLayerUp(menu.nodeId) : undefined, closeMenu())}
                >
                  <span>前移一层</span>
                  <span className={styles.menuKbd}></span>
                </button>
                <button
                  className={styles.menuItem}
                  type="button"
                  onClick={() => (menu.nodeId ? moveNodeLayerDown(menu.nodeId) : undefined, closeMenu())}
                >
                  <span>后移一层</span>
                  <span className={styles.menuKbd}></span>
                </button>
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
                  {menu.edgeId && (
                    <button
                      className={styles.menuItem}
                      type="button"
                      onClick={() => {
                        // 打开文字编辑 Popup 时，关闭节点/编组的单击 Popup
                        setShapePopup(null)
                        setInlineInspector({
                          kind: 'edge',
                          id: menu.edgeId ?? null,
                          x: menu.clientX,
                          y: menu.clientY - 12,
                        })
                        closeMenu()
                      }}
                    >
                    <span>快速编辑</span>
                    <span className={styles.menuKbd}></span>
                  </button>
                )}
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

        {!textEditingActive && shapePopup && (() => {
          const popupNode = nodes.find((n) => n.id === shapePopup.nodeId)
          if (!popupNode) return null
          if (popupNode.type === 'quad') {
            return (
              <NodeEditPopup
                node={popupNode as FlowNode}
                anchor={{ x: shapePopup.x, y: shapePopup.y }}
                onUpdate={(patch) =>
                  setNodes((nds) =>
                    nds.map((n) => {
                      if (n.id !== shapePopup.nodeId) return n
                      const nextData = { ...(n.data ?? {}), ...patch }
                      const nextNode = { ...n, data: nextData }
                      if (patch.shape === 'circle') {
                        const w = (n.measured as { width?: number })?.width ?? (n as { width?: number }).width ?? (n.style as { width?: number })?.width ?? 160
                        const h = (n.measured as { height?: number })?.height ?? (n as { height?: number }).height ?? (n.style as { height?: number })?.height ?? 44
                        const size = Math.max(Number(w) || 160, Number(h) || 44)
                        nextNode.style = { ...(n.style as object ?? {}), width: size, height: size }
                        nextNode.width = size
                        nextNode.height = size
                        // 保持中心不变：向左上偏移 (w-size)/2 和 (h-size)/2
                        nextNode.position = {
                          x: n.position.x + (Number(w) || 160 - size) / 2,
                          y: n.position.y + (Number(h) || 44 - size) / 2,
                        }
                      }
                      return nextNode
                    }),
                  )
                }
                onClose={() => setShapePopup(null)}
              />
            )
          }
          if (popupNode.type === 'group') {
            return (
              <GroupEditPopup
                node={popupNode as FlowNode as Node<GroupNodeData>}
                anchor={{ x: shapePopup.x, y: shapePopup.y }}
                onUpdate={(patch) => updateGroupStyle(shapePopup.nodeId, patch)}
                onDeleteFrameKeepContents={() => {
                  deleteFrameKeepContents(shapePopup.nodeId)
                  setShapePopup(null)
                }}
                onFillChange={(v) => {
                  const trimmed = v.trim()
                  if (trimmed.startsWith('rgba')) {
                    updateGroupStyle(shapePopup.nodeId, { fill: trimmed })
                    return
                  }
                  if (!trimmed) {
                    updateGroupStyle(shapePopup.nodeId, { fill: '' })
                    return
                  }
                  // 纯 hex 表示用户将透明度拖到 100%，直接使用该颜色（不强制 0.12）
                  const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
                  const rgb = hexToRgbColor(hex)
                  if (rgb) {
                    updateGroupStyle(shapePopup.nodeId, { fill: hex })
                  } else {
                    updateGroupStyle(shapePopup.nodeId, { fill: trimmed })
                  }
                }}
                onClose={() => setShapePopup(null)}
              />
            )
          }
          if (popupNode.type === 'asset') {
            return (
              <AssetEditPopup
                node={popupNode as FlowNode as Node<any>}
                anchor={{ x: shapePopup.x, y: shapePopup.y }}
                onUpdate={(patch) =>
                  setNodes((nds) =>
                    nds.map((n) => (n.id === shapePopup.nodeId ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n)),
                  )
                }
                onClose={() => setShapePopup(null)}
              />
            )
          }
          return null
        })()}

        {!textEditingActive && edgePopup && (() => {
          const popupEdge = edges.find((e) => e.id === edgePopup.edgeId)
          if (!popupEdge) return null
          return (
            <EdgeEditPopup
              edge={popupEdge as FlowEdge}
              anchor={{ x: edgePopup.x, y: edgePopup.y }}
              onUpdate={(patch) => updateEdgeById(edgePopup.edgeId, patch)}
              onClose={() => setEdgePopup(null)}
            />
          )
        })()}

        {!textEditingActive && (
        <InlineInspector
          anchor={inlineInspector.kind ? { x: inlineInspector.x, y: inlineInspector.y } : null}
          kind={inlineInspector.kind}
          node={inlineNode}
          edge={inlineEdge}
          onChangeNode={
            inlineInspector.kind && inlineInspector.kind !== 'edge'
              ? (patch) => {
                  if (!inlineInspector.id) return
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === inlineInspector.id
                        ? {
                            ...n,
                            data: { ...(n.data ?? {}), ...patch },
                          }
                        : n,
                    ),
                  )
                }
              : undefined
          }
          onChangeGroup={
            inlineInspector.kind === 'group'
              ? (patch) => {
                  if (!inlineInspector.id) return
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === inlineInspector.id
                        ? {
                            ...n,
                            data: { ...(n.data ?? {}), ...patch },
                          }
                        : n,
                    ),
                  )
                }
              : undefined
          }
          onChangeEdge={
            inlineInspector.kind === 'edge'
              ? (patch) => {
                  if (!inlineInspector.id) return
                  setEdges((eds) =>
                    eds.map((e) =>
                      e.id === inlineInspector.id
                        ? {
                            ...e,
                            ...patch,
                            data: { ...(e.data ?? {}), ...(patch as any).data },
                          }
                        : e,
                    ),
                  )
                }
              : undefined
          }
          onClose={() => setInlineInspector({ kind: null, id: null, x: 0, y: 0 })}
        />
        )}

        <input
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
          accept=".zip,application/zip"
          onChange={onImportFile}
        />
      </main>

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
            <div className={styles.modalHint}>文件将保存为 {exportFileName || 'Flow2Go'}.zip</div>
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

export default FlowEditor

