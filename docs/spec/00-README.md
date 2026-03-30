## Flow2Go 规格说明（Spec Index）

这组文档用于让任何同学在**不看现有代码**的前提下，仍能完整复刻 Flow2Go 的核心产品能力（类 Figma 的流程图/大图编辑器）。

### 文档结构

- `01-PRD.md`
  - 产品目标、用户、范围、功能清单、验收口径
- `02-Interaction.md`
  - 关键交互与边界条件（尤其是 Frame/画框的拖入拖出重挂载）
- `03-TechSpec.md`
  - 数据模型、模块职责、关键算法、落地实现约束（React Flow / 本地坐标系 / marker 等）
- `04-QA.md`
  - 可执行验收用例清单（按场景逐条勾选）
- `05-AI-DiagramGeneration.md`
  - AI 生成整张图（Routify OpenAI 兼容网关）：草稿/预览/应用流程、数据协议、本地归一化与验收
- `06-AI-MermaidDSL-Agent.md`
  - 主流程图路径：Mermaid DSL 中间表示、提示词位置、约束
- `07-Flow2Go-Graph-Logic-and-AI-Interfaces.md`
  - 节点/边/Group 的 **data 字段**、Graph API 抽象、**泳道 / 识图**等与 AI 对齐的说明
  - **§6 功能迭代时 AI Schema 同步清单**：每次增加「模型可产出或可解析」的字段时按表自检（类型 + prompt + 文档）

### 术语对照

- **节点（Node）**：画布上的矩形/圆形/菱形等基础元素
- **边（Edge）**：连接节点的连线，支持 label、箭头、waypoints
- **群组（Group）**：容器节点，可用于“编组/包装”；支持嵌套
- **画框（Frame）**：特殊容器节点，语义接近 Figma Frame
  - 技术上是 `type: 'group'`，并带 `data.role: 'frame'`
  - 子节点 position 为**局部坐标**，由 `parentId` 建立真实父子关系

### 复刻标准（Definition of Done）

满足以下条件即可认为“成功复刻”：
- **交互一致**：`02-Interaction.md` 中所有拖入/拖出/重挂载规则与边界条件一致
- **数据一致**：`03-TechSpec.md` 的数据模型与坐标语义一致（尤其是 `parentId` + 局部坐标）
- **可用一致**：`04-QA.md` 用例全部通过

