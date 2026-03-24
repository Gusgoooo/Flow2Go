## Flow2Go 技术规格（Tech Spec）

### 1. 技术栈与约束

- **前端**：React + TypeScript + Vite
- **画布引擎**：`@xyflow/react`（React Flow）
- **弹出层定位**：Floating UI（用于 `ColorEditor` 的 portal picker）
- **状态**：组件内 state + 历史栈（undo/redo）
- **存储**：localStorage（工程快照、素材库、最近颜色）

约束：
- Frame/Group 必须用 `parentId + 局部坐标` 实现，不允许“视觉包裹 + 假链接”
- 可逐步重构，但不得破坏现有交互（尤其是拖拽、边编辑、文字锁）

---

### 2. 数据模型（必须对齐）

#### 2.1 Node 通用字段

- `id: string`
- `type: 'quad' | 'group' | 'asset' | 'text' | ...`
- `position: { x: number, y: number }`
  - 有 `parentId`：**局部坐标**
  - 无 `parentId`：全局坐标
- `parentId?: string`
- `data: object`
- `style?: { width?: number, height?: number, ... }`
- `measured?: { width?: number, height?: number }`（React Flow 内部测量）

#### 2.2 Frame（画框）

技术上：
- `type: 'group'`
- `data.role: 'frame'`

#### 2.3 Group（群组）

技术上：
- `type: 'group'`
- `data.role !== 'frame'`（或未设置 role）

#### 2.4 Edge

- `id, source, target, type`
- `label?: string`
- `style?: { stroke, strokeWidth, ... }`
- `markerStart/markerEnd?: { type, color }`
- `data`：
  - `arrowStyle?: 'none' | 'end' | 'start' | 'both'`
  - `waypoints?: Array<{x,y}>`
  - `editingLabel?: boolean`
  - `labelStyle?: { ... }`（可以存在，但 UI 可不暴露）

#### 2.5 AssetNodeData（素材）

- `assetUrl: string`
- `assetType: 'svg'|'png'`
- `assetWidth/assetHeight: number`
- `rotation: number`（度）
- `flipX/flipY: boolean`
- `colorOverride?: GradientValue`（目前以 solid 为主；SVG 用 mask 覆盖）

---

### 3. 坐标系与工具函数（Frame 关键）

必须提供/复用以下能力（可放在 `frameUtils.ts`）：
- **绝对坐标**：沿 `parentId` 链向上累加 `position` 得到全局坐标
- **绝对 rect**：绝对坐标 + 节点尺寸（measured/width/height/style）
- **命中最佳父 Frame**：更深层优先 + 面积更小优先 + 可排除集合
- **是否应脱离父**：以光标点是否仍在父 rect 内判定（推荐）

注意：
- 不应依赖“拖拽后才更新 measured”的偶发现象；必要时主动 `updateNodeInternals`

---

### 4. 拖拽规则落地（onNodeDragStop）

建议结构：

1) 计算 `cursorFlow`（屏幕坐标转 flow 坐标）  
2) 计算 `movedIds`（单拖/多选拖）  
3) **拖出**：对 moved 集合中有 parentId 的节点，若光标不在其父内 → 触发脱离/重挂载  
4) 若未发生拖出，尝试**拖入**：
   - 用光标点命中 bestFrame（排除 movedIds）
   - 光标在 bestFrame 内 → 挂载 movedTopSet（仅顶层）

关键点：
- **拖入挂载**不得再用“节点中心点是否在框内”二次过滤
- 必须有 cycle check，防止层级循环

---

### 5. Group 编组与 bounds

创建群组时：
- picked 集合必须遵守“包含群组则不再单独 picked 其子节点”的语义（防止重复）
- bounds 必须包含：
  - picked 节点自身 rect
  - 若 picked 是 group：递归包含子孙
  - 与 picked 相关边的几何（waypoints）+ padding

---

### 6. 文字编辑互斥（textEditLock）

机制：
- 节点/群组/文本/边的编辑组件在进入编辑时派发全局事件：`flow2go:text-editing { active: true/false }`
- Editor 监听该事件：
  - active=true：关闭 shapePopup/edgePopup/inlineInspector，并禁止后续 click/contextmenu 打开
  - active=false：恢复正常

要点：
- 与 `ColorEditor` 的 portal picker 交互不能导致其他菜单“复活”

---

### 7. 发布与 SVG 箭头 marker

问题：
- 线上环境可能注入 `<base>`，导致 SVG 内部 `url(#markerId)` 引用失效 → 箭头丢失

要求：
- 启动时移除 `<base>`（或至少避免其影响 marker 引用）
- 验证生产环境箭头可见

---

### 8. 触摸板体验配置（ReactFlow）

推荐：
- `preventScrolling`
- `zoomOnScroll` + `zoomOnPinch`
- `panOnScroll`

--- 

### 9. 模块职责建议（参考实现）

- `src/flow/FlowEditor.tsx`：主状态与事件（drag rules、menus、history）
- `src/flow/frameUtils.ts`：坐标与命中规则
- `src/flow/*EditPopup.tsx`：紧凑 popup（统一 `ColorEditor`）
- `src/flow/EditableSmoothStepEdge.tsx`：waypoints/label 编辑
- `src/flow/AssetNode.tsx` + `AssetEditPopup.tsx`：素材变换与颜色覆盖

