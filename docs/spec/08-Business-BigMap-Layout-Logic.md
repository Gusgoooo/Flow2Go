# Business Big Map 布局逻辑复盘（当前实现）

本文档用于复盘 `business-big-map` 布局实现，覆盖宽度档位、递归顺序、padding 约束、子画框重挂载与节点排版。

对应代码文件：`src/flow/mermaid/apply.ts`，核心函数：`wrapFramesToContents(allNodes, businessMode)`。

---

## 1. 入口与触发

- 仅当 `payload.meta.layoutProfile === 'business-big-map'` 时进入业务大图布局模式。
- 业务大图模式在 `materializeGraphBatchPayloadToSnapshot` 中调用 `wrapFramesToContents(safeNodes, businessMode)`。

---

## 2. 基础常量（当前）

- `LAYOUT_UNIT = 24`
- `BUSINESS_INNER_UNIT = 12`
- Business mode 最小节点宽度单位：`NODE_MIN_WIDTH_UNITS = 1.5`（用于让递归计算把单元压到更紧凑）
- `BUSINESS_CHAPTER_W_30 = 30 * LAYOUT_UNIT = 720`
- `BUSINESS_CHAPTER_W_50 = 50 * LAYOUT_UNIT = 1200`
- `BUSINESS_CHAPTER_W_70 = 70 * LAYOUT_UNIT`
- `BUSINESS_CHAPTER_W_90 = 90 * LAYOUT_UNIT`
- `UNIT = businessMode ? BUSINESS_INNER_UNIT : LAYOUT_UNIT`
- `MIN_NODE_W = round(UNIT * NODE_MIN_WIDTH_UNITS)`（业务模式 `NODE_MIN_WIDTH_UNITS = 1.5`）

说明：
- 业务模式下使用更细的内层单位（12px）；
- 节点最小宽度是按单位计算，不再写死 120px。

---

## 3. 顶层宽度档位规则（30/50/70/90/120）

函数：`calcBusinessUnifiedTopChapterWidth()`

- 遍历每个顶层章节 `frame`（没有 `parentId`）
- 对每个顶层章节递归计算“所需最小宽度 requiredWidthForFrame(frameId)”（只基于子 frame 的分叉与递归传递；用于避免估算偏小导致的布局挤压）
- 顶层统一宽度采用“**递进一档**”规则：
  - 先取基础档位（floor）：`<= globalNeed` 的最大档位
  - 当基础档位为 `50` 则统一取 `70`
  - 当基础档位为 `70` 则统一取 `90`
  - 当基础档位为 `90` 则统一取 `120`
  - 当基础档位为 `30` 时不额外上调（避免小图被无谓放大）
- 最终全局统一：所有顶层章节取其 requiredWidth 的 `globalNeed` 对应的最小满足档位（并用于所有顶层章节宽度）

输出用于顶层章节宽度：`businessUnifiedTopChapterWidth`。

---

## 4. 父子结构约束（重挂载）

函数：`enforceMaxNestedFrames(rootFrameId, maxChildren = 3)`

目的：
- 限制任意父 frame 的“直接子 frame”数量不超过 3。

策略：
- BFS 遍历 frame 树；
- 若直接子 frame 超过上限，保留前 `maxChildren` 个，多余 frame 轮流重挂载到保留的 frame 下；
- 重挂载前会做防环判断（`isDescendantFrame`），避免形成循环；
- 重挂载后继续迭代校正，直到所有父级满足约束。

---

## 5. 递归布局主流程

函数：`layoutBusinessFrame(frame, forcedWidth?)`

每层固定流程：

1. 先执行 `enforceMaxNestedFrames(frame.id, 3)`，保证当前子树结构合法。  
2. 拆分当前层孩子：
   - `childFrames`（直接子 frame）
   - `childNodes`（直接子节点，非 frame）
3. 计算当前 frame 宽度：
   - 顶层：`getBusinessChapterWidth(true)`（30 或 50）
   - 非顶层：`max(forcedWidth, MIN_W_DEFAULT)`
4. 布局 `childFrames`（优先横向）：
   - 每行最多 3 个：`cols = min(3, childFrames.length)`
   - `cellW = max(MIN_NODE_W, floor((availableW - (cols - 1) * UNIT) / cols))`
   - 先递归子 frame（传入 `cellW`），再按网格位置回填 `position`
5. 布局 `childNodes`（最多 2 列）：
   - 若有子 frame，节点起始 y 在其下方并加一个 `UNIT` 间隔
   - `cols = min(2, childNodes.length)`
   - 同样按 `availableW` 计算 cell 宽并定位
6. 重新计算包围盒并回写当前 frame：
   - 保持当前 frame 宽度不变（`nextW = frameW`）
   - 高度按内容 + 顶部标题区 + 底部 padding 自动扩展
   - 最后把孩子整体平移到带 padding 的局部坐标系中（居中补偿）。

---

## 6. Padding 与可用宽度

当前业务模式：
- `padX = UNIT`
- `padTop = TITLE_H + round(UNIT * 1.35)`
- `padBottom = UNIT`
- `availableW = frameW - 2 * padX`

所有子画框/子节点列宽计算都基于 `availableW`，保证不会直接顶到边框。

---

## 7. 当前已知影响

- 由于“父级最多 3 个直接子 frame”约束，若模型输出同层过多 frame，会发生自动重挂载（结构会被重排）。
- 顶层 50 档只保证顶层章节宽度；非顶层宽度由父层分配宽度递归决定（不是全层固定 50）。
- 节点最多 2 列是硬策略，优先可读性和纵向节奏。

---

## 8. 这份文档适用范围

- 仅描述当前 `main` 分支上业务大图布局逻辑；
- 若后续修改 `apply.ts` 的策略（特别是宽度档位、重挂载、列数规则），应同步更新本文档。
