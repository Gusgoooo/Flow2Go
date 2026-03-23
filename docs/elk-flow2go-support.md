# Flow2Go 与 ELK：能力矩阵（走查说明）

本文描述 **Mermaid 物化 / 流程图** 路径里，`elkjs` 实际参与的方式，以及 **React Flow 节点 API** 与 ELK 原生能力的对应关系。

## 调用位置

- 文件：`src/flow/layout.ts` → `autoLayout()`
- 算法：`elk.algorithm = layered`（分层有向图布局）
- 方向：`elk.direction` 由 Mermaid 的 `flowchart LR|TB|RL|BT` 映射为 `RIGHT|DOWN|LEFT|UP`
- 额外选项：`org.eclipse.elk.separateConnectedComponents = true`（不连通子图分开摆放，间距用 ELK 默认）
- **间距**：默认 **不** 写入 `elk.spacing.*` / `org.eclipse.elk.padding`，即使用 ELK 内置默认；仅在调用方传入 `LayoutSpacingOptions` 时覆盖。

## 物化时的调用粒度（`apply.ts`）

1. **`graph.autoLayout` + `scope: 'withinFrame'`**  
   对每个 subgraph 对应的 frame，取其 **直接子节点**（quad 等）与 **两端都在该 frame 内** 的边，跑一次 `autoLayout`。  
   **注意**：这里传给 ELK 的是「扁平」子节点列表 + 边表，**不是**把整个 React Flow 父子树嵌套成一个 ELK 层次图。

2. **`graph.autoLayout` + `scope: 'all'`**（transpiler 在存在顶层节点时追加）  
   对 **无 `parentId` 的顶层节点**（含顶层 `group` 画框）与 **两端都在顶层** 的边，再跑一次 `autoLayout`。

3. **`wrapFramesToContents` 之后**  
   若非 `mind-map`，且存在顶层 frame，会再调用 **`layoutTopLevel`**：同样只对顶层节点与顶层边做一次 ELK，用于拉开多个顶层画框/顶层节点的位置。

**结论**：ELK 每次看到的是「当前这一层的矩形节点 + 边」，**不会**把嵌套 frame 当成 ELK 的 `children` 层次图一次性整体求解（与「整图一个 ELK 根、子图嵌套」的用法不同）。

## 传给 ELK 的「节点」信息（支持）

| 信息 | 说明 |
|------|------|
| `id` | 与 Flow2Go 节点 id 一致 |
| `width` / `height` | 来自 `measured` → `width/height` → 默认约 180×44（quad 默认 160×44 等） |
| 边 `sources` / `targets` | 仅支持 **单源单宿**（与当前 `Edge` 模型一致） |

即：ELK 把每个节点当作 **轴对齐矩形**，**不知道** React Flow 里的 `type`（quad/group/text）、圆角、描边、`data` 里的标题样式等。

## 当前 **未** 使用 / 不支持的 ELK 特性（相对 elk 全能力）

以下在 **本项目的 `autoLayout` 封装中未传入**，因此 **不起作用**（或不由 ELK 控制）：

- **端口（ports）**、边接到节点上的具体锚点 —— 由后续 `applyInferredEdgeHandles` 等逻辑在 XYFlow 侧推断句柄。
- **边的路由样式**（正交/曲线层级路由细节）— ELK 只产出 **节点位置**；边在画布上由 `smoothstep`/`bezier` 等边组件绘制。
- **节点标签在 ELK 内排版** — 标签是 React 节点渲染，宽度高度来自前端测量或默认值，不是 ELK `labels` 配置。
- **其它算法**：`force`、`stress`、`mrtree` 等 —— 未使用，仅 `layered`。
- **分层图的高级选项**（大量 `org.eclipse.elk.layered.*` 细项）— 除 `separateConnectedComponents` 与可选 `spacing` 外，**未逐项暴露**。
- **层次嵌套的一张 ELK 图**（父节点 `children` 含子图、边可跨层）— 当前实现是 **分帧 / 分层多次** `layout`，而不是单次嵌套 ELK 图。

## Flow2Go 节点类型与 ELK 的关系

| 节点/能力 | 进入 ELK 时 | 备注 |
|-----------|-------------|------|
| `group` + `data.role === 'frame'` | 与其它节点一样，矩形 w×h | 仅遵循当前通用布局链路 |
| `quad`（rect/circle/diamond） | 仅外接矩形尺寸 | 形状不影响 ELK，只影响渲染 |
| `text` 等 | 若出现在同一 batch 且参与 layout，同理 | 取决于图操作是否创建及是否在该 scope 内 |
| `mind-map` | **不**走上述 ELK 流程图链 | 使用 `mind-elixir` 风格布局（`mindElixirLayout.ts`） |

## 小结

- **支持**：`layered` + 方向映射 + 不连通分量分离 + 可选间距覆盖；为流程图提供 **节点（框）平面位置**。  
- **不支持（当前封装）**：ELK 端口、边标签布局、非 layered 算法、单次嵌套整图 ELK、细粒度 layered 调参（除非扩展 `LayoutSpacingOptions` 或改 `buildElkLayoutOptions`）。

若以后要「更接近 ELK 官方 hierarchical」行为，需要把 **frame 作为 ELK 父节点、`children` 为内部节点** 建图并一次 `layout`，属于架构级改动，与现有多段 `autoLayout` 不同。
