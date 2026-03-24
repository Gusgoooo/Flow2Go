## Flow2Go 交互规格（Interaction Spec）

### 0. 总原则

- **Frame 是真实容器**：父子关系必须落在数据结构里（`parentId`），子节点 position 为局部坐标。
- **用户意图以光标落点表达**：拖入/拖出/重挂载的判定以“松手时光标在哪里”为准，而不是节点中心点。
- **一次拖动不打散树结构**：多选拖动时只重挂载 moved 集合中的“顶层节点”，其子孙自然随树移动。

---

### 1. 点击/双击/右键

#### 1.1 点击节点（Node Click）

- 点击 `quad/group/frame/asset`：弹出对应紧凑 popup（位置在节点上方居中，间距 8px）。
- 点击边（Edge）：弹出边 popup（同样 8px），但需做**延迟打开**以避免与双击冲突。

#### 1.2 双击边 label（Edge Double Click）

- 双击边 label：进入文字编辑状态
- 开启全局 `textEditLock`：
  - 关闭 `shapePopup/edgePopup/inlineInspector`
  - 在编辑结束前，任何 node/edge click/contextmenu 不得重新打开上述菜单
  - 与颜色拾色板等 portal 弹层交互时也不能“复活”其他菜单

#### 1.3 右键菜单

- 右键画布空白：画布菜单
- 右键节点/边：节点/边菜单（必须避免 capture 层把事件吞掉）
- 多选时：右键选中集合中的任意元素应显示“多选菜单”

---

### 2. Frame（画框）嵌套与拖拽规则（核心）

#### 2.1 命中 Frame 的规则（findBestParentFrame）

输入：一个点（通常是光标点）  
输出：最佳 Frame

优先级：
- **更深层优先**（离根更远）
- 同深度时，**面积更小优先**（更“里层”的 Frame）
- 必须支持排除集合：拖动某个 Frame 时，命中判定需排除“本次移动集合中的 frame”，避免把自己当成父

#### 2.2 拖入 Frame（Drag-in）

触发时机：`onNodeDragStop`

判定：
- 若松手时**光标点**位于某个 Frame 内，则视为用户想“拖入该 Frame”。
- 只重挂载 `movedIds` 中的**顶层节点**（其祖先不在 `movedIds`）。

行为：
- 对每个被重挂载节点：
  - 设置 `parentId = bestFrame.id`
  - 将节点位置转为局部坐标：  
    `position = childAbsPos - frameAbsPos`
- 禁止循环：
  - 不能把节点挂到自己或自己后代下面（cycle check）

禁止的“错误实现”：
- 用节点中心点/矩形是否在 Frame 内作为二次过滤（会导致“大画框拖进一部分但中心仍在外 → 无法成为子集”）

#### 2.3 拖出 Frame（Drag-out）

触发时机：`onNodeDragStop`

判定（以光标表达意图）：
- 若节点存在 `parentId`：
  - 当松手时光标点不再位于当前 parent Frame 内 → 视为用户想“拖出”

行为（Figma 语义：重挂载优先）：
- 当拖出发生时：
  - 找到光标点所在的最佳 Frame（排除 moved 集）
  - 若命中 Frame：**重挂载到该 Frame**
  - 否则：脱离到根层（`parentId = undefined`，position 为全局绝对坐标）

#### 2.4 Frame 内子元素随动

- 拖动 Frame：其子树整体随动（依赖 React Flow 的 parentId/局部坐标语义）
- 调整 Frame 大小（resize）：
  - 不应影响内部节点/边的绝对位置（只改变边框）
  - 详见“容器 resize”规则

---

### 3. Group（群组）编组规则（嵌套与 bounds）

#### 3.1 允许创建

- 选中 ≥2：创建群组包裹
- 只选 1 个：仅当该节点是 group 时允许“包装一层”

#### 3.2 新群组 bounds 计算

对每个 picked 项：
- 若为普通节点：取自身绝对 rect
- 若为 group：递归包含所有子孙绝对 rect
- 同时纳入“群组内部相关边”的几何：
  - 至少包含 `edge.data.waypoints`
  - 并给安全 padding（默认正交线外扩）

#### 3.3 防循环

- `commonParentId` 计算时必须排除 picked 集合内部的 parentId，避免 A.parentId=G 且 G.parentId=A

---

### 4. 容器 resize（左上角手柄等）

规则：
- resize 时可能同时出现 `dimensions` + `position` change
- 为实现“调整容器大小不影响内部元素绝对位置”：
  - 只对**直接子节点**做 position 的反向补偿
  - 不得对所有子孙补偿（嵌套容器会重复补偿导致错位）
- resize 期间禁止平移 edge waypoints（避免折线诡异变化）

---

### 5. 触摸板/滚轮体验（Mac 优先）

推荐组合：
- `preventScrolling = true`（避免页面滚动/浏览器手势抢占）
- `zoomOnScroll = true`（触摸板 pinch 常以 wheel+ctrlKey 形式出现）
- `zoomOnPinch = true`
- `panOnScroll = true`（双指滚动平移画布）

