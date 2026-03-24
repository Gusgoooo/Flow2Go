## AI 生成整张图（OpenRouter）规格说明

### 0. 目标

在不影响 Flow2Go 原生编辑体验（Frame/编组/边编辑/文字锁）的前提下，引入 **AI 生成整张图**能力：

- 用户输入自然语言 → AI 生成一份“候选图草稿”
- 编辑器提供 **预览/确认/一键应用**（可撤销）
- 应用时必须满足 Flow2Go 的核心语义：尤其是 **Frame 的 `parentId + 局部坐标`**

**原则**：AI 只负责“提议”，最终落盘必须经过本地校验与归一化。

---

### 1. 非目标（第一期不做）

- 实时协作 + AI
- AI 直接修改现有复杂图的 diff（第二期再做：选区增量改写）
- AI 直接生成多层 Frame/Group 的精确布局并保证 100% 可用（第一期可由本地 layout/归一化兜底）

---

### 2. 入口与 UI（不破坏原生体验）

#### 2.1 入口位置（推荐）

复用你现有的“素材侧边栏 AI 区域”的心智模型，新增一个 Tab/折叠区：
- **AI：生成整张图**

#### 2.2 交互流程（强制）

1) 用户输入 Prompt
2) 点击“生成”
3) 得到 **AI 草稿**（draft snapshot），进入预览态：
   - 显示摘要（节点数/边数/包含 Frame 数）
   - 显示一个“预览缩略图/预览视图”（实现方式见 2.3）
   - 提供按钮：
     - **应用到画布**（会进入 history，可 undo）
     - **插入到光标位置**（可选）
     - **取消/丢弃草稿**
4) 应用后：
   - `pushHistory(nextNodes, nextEdges, 'ai-apply')`
   - 自动 `fitView` 或使用草稿 viewport（可配置）

#### 2.3 预览方案（两种可选，建议先做 A）

- A：**Modal + 第二个 ReactFlow 实例预览**（只读）
  - 优点：与真实渲染完全一致
  - 风险：实现稍复杂，但最可靠
- B：缩略统计 + “应用后可撤销”作为安全网
  - 优点：最快
  - 风险：用户不确定性更高

---

### 3. OpenRouter（BYOK）接入规范

#### 3.1 Key 管理

- 第一优先：`localStorage`（用户在 UI 输入后存储）
- 第二优先：`import.meta.env.VITE_OPENROUTER_API_KEY`
- UI 必须提示：
  - Key 只保存在本地，不上传你的服务器（Local-first）

#### 3.2 API 调用（文本生成）

- Endpoint：`https://openrouter.ai/api/v1/chat/completions`
- 请求必须支持：
  - 取消（`AbortController`）
  - 超时（如 45s）
  - 明确的错误映射：无 key / 401 / 429 / 5xx

#### 3.3 模型选择

第一期用一个默认模型（可配），并预留 UI 下拉（第二期再加）。

---

### 4. AI 输出协议（关键：可校验、可归一化）

AI 生成的结果必须是**严格 JSON**，不允许夹杂解释文本。

#### 4.1 顶层结构（DraftDiagram v1）

```json
{
  "schema": "flow2go.ai.diagram.v1",
  "title": "optional",
  "nodes": [
    {
      "id": "n1",
      "type": "quad | group | text | asset",
      "position": { "x": 0, "y": 0 },
      "parentId": "optional",
      "width": 160,
      "height": 44,
      "data": {}
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "n1",
      "target": "n2",
      "type": "smoothstep | bezier",
      "label": "optional",
      "style": { "stroke": "#94a3b8", "strokeWidth": 3 },
      "data": { "arrowStyle": "end" }
    }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

#### 4.2 必须约束（强制校验）

- `schema` 必须等于 `flow2go.ai.diagram.v1`
- 所有 `id` 唯一
- edge 的 `source/target` 必须存在于 nodes
- `type` 只能是当前支持的集合（未知类型丢弃或降级为 quad）
- `position` 必须是有限数字

#### 4.3 Frame/Group 约束（重要）

- Frame 技术上是 `type: 'group'` 且 `data.role: 'frame'`
- `parentId` 仅允许指向 `type:'group'` 的节点
- 第一阶段允许 AI 不输出 `parentId`（全部顶层），由本地做 Frame 包裹（见 6）

---

### 5. Prompt 模板（让 AI 输出更稳定）

系统提示词（核心点）：
- “只输出 JSON”
- “使用 schema v1”
- “不要生成过深嵌套，除非用户明确要求”
- “位置单位为 flow 坐标，建议以网格 12/18 递增”
- “边默认带终点箭头（arrowStyle=end）”

用户提示词拼接建议（可选）：
- 当前画布风格 token（默认颜色、圆角 12px、默认边颜色等）
- 节点类型可用列表与字段说明（简化版）

---

### 6. 本地归一化（Normalization）——保证不破坏 Frame 语义

AI 输出只是“草稿”，应用前必须做归一化：

#### 6.1 ID 重写（强烈建议）

避免与现有画布冲突：
- 新图作为“替换画布”时：可保留 id
- 新图作为“插入画布”时：必须重写 id，并同步 edges 的 source/target

#### 6.2 坐标与尺寸

- 缺失 `width/height` 时使用默认值（与你现有节点默认一致）
- 所有节点坐标先视为**全局坐标**

#### 6.3 Frame 包裹（第一期推荐策略）

为降低 AI 难度，第一期提供一种确定性策略：

- 若 AI 输出包含 Frame（`group + role=frame`）且输出了 `parentId`：
  - 校验无环；将 child 的 position 转为局部坐标（通过 `abs - frameAbs`）
- 若 AI 输出没有 `parentId` 或不可靠：
  - 选择一种简单规则生成 Frame/Group 层级（例如：仅顶层 Frame，不嵌套），或直接忽略 parentId

#### 6.4 waypoints

第一期允许不生成 waypoints（交给你的边组件默认路由）。
若 AI 生成了 waypoints：
- 必须校验为有限数字
- 视为全局坐标（与你当前实现一致）

---

### 7. 应用到画布（必须可撤销）

#### 7.1 “替换画布”模式

- `setNodes(draftNodes)`
- `setEdges(draftEdges)`
- `pushHistory(draftNodes, draftEdges, 'ai-apply')`

#### 7.2 “插入到光标位置”模式（可选）

- 以光标 flow 坐标作为插入偏移
- 将草稿整体 bbox 左上对齐到光标附近
- 插入后 `assignZIndex`，并 `pushHistory`

---

### 8. 与原生体验的隔离约束（强制）

- AI 面板不改变任何默认交互：
  - Frame 拖入/拖出/重挂载规则保持不变（见 `02-Interaction.md`）
  - 文字编辑锁 `textEditLock` 不得被 AI 面板打断
- AI 请求失败不影响画布：
  - 失败只展示在面板内，不弹阻塞对话框
- AI 应用必须可撤销：
  - 所有写入 nodes/edges 的动作都要 `pushHistory`

---

### 9. 验收用例（补充到 QA）

- [ ] 无 OpenRouter Key：面板提示并禁用“生成”
- [ ] 生成成功：出现草稿摘要 + 预览 + 应用按钮
- [ ] 应用后：画布节点/边出现，且 Undo 可回滚到应用前
- [ ] 草稿含 Frame：应用后拖入/拖出行为仍符合 `02-Interaction.md`
- [ ] AI 输出非法 JSON：能提示错误且不影响画布
- [ ] 取消请求：loading 立即停止且不影响画布

