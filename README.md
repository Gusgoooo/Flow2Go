# Flow2Go（类 Figma 的大图编辑器）

Flow2Go 是一个基于 `@xyflow/react`（React Flow）的浏览器端大图/流程图编辑器。核心目标是让你用接近 Figma 的方式组织内容：**节点 + 边 + 画框(Frame)容器 + 素材**，并支持嵌套、拖入/拖出重挂载、快速编辑与保存。

## 核心特性

- **Frame（画框）是真实容器**：用 `parentId` 建立父子关系，子节点坐标是父容器的**局部坐标**（不是视觉包裹）
- **Frame 可嵌套**：支持 A 包 B 包 C；拖出 C 时光标落在 B/A 内会重挂载到 B/A（Figma 语义）
- **编组（Group）可多层嵌套**：允许对群组再包一层；bounds 计算包含子树与相关边几何
- **边（Edge）**：label 双击编辑；菜单保留简洁项（类型/箭头/颜色/线宽/动画）
- **可编辑折线**：支持 waypoints 拖拽与随动
- **素材（Asset）**：导入 SVG/PNG；45°步进旋转、水平/垂直翻转；SVG 支持颜色覆盖（同款拾色板）
- **统一 UI**：全局圆角 12px；ColorEditor 统一色板（预设 + 最近使用 + portal）
- **发布稳定性**：处理 `<base>` 导致 SVG marker（箭头）丢失的问题
- **触摸板体验**：优化 Mac 触摸板的缩放/滚动手势

## 文档（复刻/协作用）

规格说明在 `docs/spec/`：
- `docs/spec/00-README.md`：索引与术语
- `docs/spec/01-PRD.md`：产品需求
- `docs/spec/02-Interaction.md`：交互规则（Frame 拖入/拖出/重挂载）
- `docs/spec/03-TechSpec.md`：技术规格（数据模型/坐标系/关键算法）
- `docs/spec/04-QA.md`：验收用例清单

## 快速开始（本地开发）

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。

## 构建

```bash
npm run build
```

产物在 `dist/`。

## Docker（可选）

### 开发模式（热更新）

```bash
docker compose up --build flow2go-dev
```

打开 `http://localhost:5173`。

### 生产模式（Nginx 静态托管）

```bash
docker compose up --build flow2go-prod
```

打开 `http://localhost:8080`。

## 常见问题

### 1) 发布后箭头（SVG marker）丢失

某些托管平台会注入 `<base>`，导致 SVG 内部 `url(#...)` 引用失效，箭头 marker 找不到。项目在启动时会移除 `<base>` 以规避该问题。
