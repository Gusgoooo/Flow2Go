## Flow2Go 图形元素逻辑 & AI 可调用接口（Mermaid 映射版）

本文件目标：把 Flow2Go 里「节点 / 边 / 画框(Frame) / 编组(Group)」的**真实逻辑**抽象成一组 **AI 可识别的接口**（Graph API），用于：

1) 大模型把自然语言转译成 Mermaid DSL  
2) 你的系统把 Mermaid DSL 解析成 Graph API 调用序列  
3) Flow2Go 根据调用序列绘制、布局并可编辑

> 术语说明  
> - **Frame（画框）**：技术上就是 `type="group"` 的节点，并且 `data.role="frame"`  
> - **Group（编组）**：同样是 `type="group"`，但 `data.role` 为空/非 frame，通常用不同的 stroke/fill 表现  
> - **局部坐标语义**：当节点有 `parentId` 时，其 `position` 是相对父容器的局部坐标；没有 `parentId` 时为画布坐标

---

### 1. 图形数据模型（当前代码现状）

#### 1.1 Node（节点）

当前节点类型集合（见 `src/flow/FlowEditor.tsx` 的 `nodeTypesFull`）：

- **`quad`**：通用矩形/圆/菱形节点（可编辑标题/副标题、样式、缩放）
- **`text`**：纯文字节点（可编辑文字样式、缩放）
- **`asset`**：素材节点（PNG/SVG、支持尺寸、旋转/翻转、SVG 颜色覆盖）
- **`group`**：容器节点（用于 Frame 或 Group）

通用关键字段（React Flow Node）：

- **`id`**: string
- **`type`**: `'quad' | 'text' | 'asset' | 'group'`
- **`position`**: `{x:number,y:number}`  
  - 若存在 `parentId`：这是父容器的局部坐标  
  - 否则：画布绝对坐标
- **`parentId?`**: string（父容器 id）
- **`width/height?`**: number（尤其 group/frame 会显式持有）
- **`data`**: 不同类型节点的业务字段（见下）

#### 1.2 Edge（边）

当前边类型集合（见 `src/flow/FlowEditor.tsx` 的 `edgeTypes`）：

- **`smoothstep`**：自定义 `EditableSmoothStepEdge`，默认正交路径 + 可编辑 waypoints + label 双击编辑  
- **`bezier`**：BezierEdge（库内置）

关键字段：

- **`id`**: string
- **`source` / `target`**: 节点 id
- **`type`**: `'smoothstep' | 'bezier'`（默认 smoothstep）
- **`label?`**: string（可选）
- **`style?`**: `{ stroke, strokeWidth, ... }`
- **`markerStart/markerEnd?`**: 箭头（见 EdgeEditPopup）
- **`data.arrowStyle?`**: `'none' | 'end' | 'start' | 'both'`（业务箭头风格）
- **`data.waypoints?`**: `Array<{x:number,y:number}>`（EditableSmoothStepEdge 用）

#### 1.3 Frame（画框）

Frame 的判定方式（见 `addFrameAtPosition`）：

- `type: 'group'`
- `data.role: 'frame'`
- `data.title/titleFontSize/titleColor/stroke/fill...`
- `width/height` 显式存在（默认 640×420）

#### 1.4 Group（编组）

Group 同样是 `type:'group'`，但通常不设置 `data.role='frame'`。  
现有“编组”逻辑是：把选中节点集包进一个新 group，并重算它们的局部坐标（见 `groupSelection`）。

---

### 2. 各节点类型 data 字段（用于 AI 协议）

#### 2.1 `quad`（见 `src/flow/QuadNode.tsx`）

推荐你对外暴露的最小字段：

- **`title` / `label`**: string（标题；代码里 commit 会同时写 `label`+`title`）
- **`subtitle?`**: string
- **`showSubtitle?`**: boolean
- **`shape?`**: `'rect' | 'circle' | 'diamond'`
- **`color?`**: string（支持 `#rrggbb` 或 `rgba(...)`）
- **`stroke?`**: string
- **`strokeWidth?`**: number
- **文本样式**：`labelFontSize/labelFontWeight/labelColor/subtitleFontSize`

#### 2.2 `text`（见 `src/flow/TextNode.tsx`）

- **`label`**: string
- **文本样式**：`labelFontSize/labelFontWeight/labelColor`

#### 2.3 `asset`（见 `src/flow/AssetNode.tsx`）

- **`assetUrl`**: string（dataUrl）
- **`assetName?`**: string
- **`assetType?`**: `'svg'|'png'`
- **`assetWidth/assetHeight?`**: number
- **`rotation?`**: number（度）
- **`flipX/flipY?`**: boolean
- **`colorOverride?`**: 渐变/颜色覆盖（仅 SVG，见 `GradientColorEditor`）

#### 2.4 `group`（Frame/Group）（见 `src/flow/GroupNode.tsx`）

- **`title?`**: string（双击编辑）
- **`subtitle?`**: string
- **`showSubtitle?`**: boolean
- **`titlePosition?`**: `'top-center'|'left-center'`
- **`stroke/strokeWidth/fill?`**: string/number（样式）
- **`titleFontSize/titleFontWeight/titleColor/subtitleFontSize?`**
- **`role?`**: `'frame'`（仅 Frame）

---

### 3. 交互/功能逻辑清单（你需要“做成 AI 接口”的部分）

下面按「AI 可以做什么」分组，每个能力建议抽象成一个 Graph API。

#### 3.1 创建类（Create）

- **`graph.createNodeQuad`**
  - **params**: `{ id?, title, subtitle?, shape?, style?, position, parentId? }`
  - **effect**: 新增 `type:'quad'` 节点

- **`graph.createNodeText`**
  - **params**: `{ id?, text, style?, position, parentId? }`

- **`graph.createNodeAsset`**
  - **params**: `{ id?, assetUrl, assetType, size?, transform?, position, parentId? }`

- **`graph.createFrame`**
  - **params**: `{ id?, title, position, size, style? }`
  - **effect**: 新增 `type:'group'` + `data.role='frame'`

- **`graph.createGroup`**
  - **params**: `{ id?, title?, position, size?, style? }`

- **`graph.createEdge`**
  - **params**: `{ id?, source, target, type?, label?, arrowStyle?, style? }`
  - **default**: `type='smoothstep'`、arrowStyle=`end`
  - **note**: 边 label 支持双击编辑（UI）

#### 3.2 编辑类（Update）

- **`graph.updateNode`**
  - **params**: `{ id, patch: { position?, parentId?, width?, height?, data?: partial } }`

- **`graph.updateEdge`**
  - **params**: `{ id, patch: { label?, type?, style?, arrowStyle?, waypoints? } }`
  - 对应 UI：`EdgeEditPopup`（类型、箭头、颜色、线宽、动画）

#### 3.3 结构类（Hierarchy / Reparent）

Flow2Go 的核心语义（Figma 语义）：

- 节点有 `parentId` 时：`position` 是父容器的局部坐标
- 拖入/拖出 Frame 时，会发生重挂载（reparent）并重算坐标

建议接口：

- **`graph.reparentNodes`**
  - **params**: `{ nodeIds: string[], newParentId?: string, keepWorldPosition: boolean }`
  - **effect**:
    - `newParentId` 存在：把节点挂到该容器下，并把 position 转为局部坐标  
    - `newParentId` 为空：解绑为顶层节点，并把 position 转为画布坐标

- **`graph.groupSelection`**
  - **params**: `{ nodeIds: string[], title?, style? }`
  - **effect**: 创建一个新 group 包裹这些节点（对应现有 `groupSelection`）

#### 3.4 删除类（Delete）

- **`graph.deleteNodes`** / **`graph.deleteEdges`**
  - 需注意：删除节点时要同时删除与其相连的边（现有 `deleteSelection` 就是这么做的）

- **`graph.deleteFrameKeepChildren`**（可选）
  - **effect**: 删除 frame，但把子节点提升到 frame 的 parent 或顶层，并转换坐标（代码里已有类似逻辑）

#### 3.5 布局类（Layout）

现有自动布局工具（见 `src/flow/layout.ts`）基于 `dagre`：

- **`graph.autoLayout`**
  - **params**: `{ direction: 'LR'|'TB', scope?: 'all'|'withinFrame', frameId? }`
  - **effect**: 重新计算 position（不会自动建边）

> 你当前的 AI Mermaid 映射里已经对每个 subgraph 内节点做了 autoLayout，然后再放进 Frame。

#### 3.6 选择/历史（Undo/Redo）

现有机制：

- 修改 nodes/edges 时通过 `pushHistory(nextNodes,nextEdges,reason)` 入栈
- undo/redo 基于快照

如果未来让 AI 直接“调用接口绘制”，建议：

- 所有 AI 批量操作用一次 `graph.batch` 包裹，并且只入栈一次（reason=`ai-apply`）

---

### 4. Mermaid DSL → Graph API 映射建议（你要用的“匹配用”）

#### 4.1 subgraph 映射 Frame

Mermaid：

```text
subgraph Frontend
  fe_login[登录页]
end
```

映射：

1) `graph.createFrame({ title:'Frontend' })` → frameId=`g_frontend`
2) subgraph 内所有节点 `parentId=frameId`
3) subgraph 内部做 `graph.autoLayout({scope:'withinFrame', frameId})`

#### 4.2 节点声明映射 Node

Mermaid：

```text
fe_login[登录页]
be_auth[鉴权服务]
```

映射（第一期建议全部用 quad）：

- `graph.createNodeQuad({ id:'fe_login', title:'登录页', parentId:'g_frontend' })`
- `graph.createNodeQuad({ id:'be_auth', title:'鉴权服务', parentId:'g_backend' })`

#### 4.3 边映射 Edge

Mermaid：

```text
fe_login -->|提交| be_auth
```

映射：

- `graph.createEdge({ source:'fe_login', target:'be_auth', label:'提交', type:'smoothstep', arrowStyle:'end' })`

---

### 5. 第一阶段建议的“最小可用 AI 接口集合”

为了先跑通“自然语言 → Mermaid → 绘制”，建议接口先只做这 8 个：

1) `graph.createFrame`
2) `graph.createNodeQuad`
3) `graph.createEdge`
4) `graph.autoLayout`
5) `graph.reparentNodes`（后续支持拖入/拖出语义时用）
6) `graph.updateNode`（改标题/样式）
7) `graph.updateEdge`（改 label/箭头/线型）
8) `graph.batch`（一次性应用，保证 undo/redo 体验）

等第一期稳定，再扩展：

- `text/asset` 节点的 AI 创建
- `groupSelection` 语义（Mermaid 中用子 subgraph 或特定标记触发）
- waypoints（让 AI 指定折线路径点）

