# Flow2Go（类 Figma 的大图编辑器）

Flow2Go 是一个基于 `@xyflow/react`（React Flow）的浏览器端大图/流程图编辑器。核心目标是让你用接近 Figma 的方式组织内容：**节点 + 边 + 画框(Frame)容器 + 素材**，并支持嵌套、拖入/拖出重挂载、快速编辑与保存。

## 核心特性

- **Frame（画框）是真实容器**：用 `parentId` 建立父子关系，子节点坐标是父容器的**局部坐标**（不是视觉包裹）
- **Frame 可嵌套**：支持 A 包 B 包 C；拖出 C 时光标落在 B/A 内会重挂载到 B/A（Figma 语义）
- **编组（Group）可多层嵌套**：允许对群组再包一层；bounds 计算包含子树与相关边几何
- **边（Edge）**：label 双击编辑；菜单保留简洁项（类型/箭头/颜色/线宽/动画）
- **可编辑折线**：支持 waypoints 拖拽与随动
- **素材（Asset）**：导入 SVG/PNG；45°步进旋转、水平/垂直翻转；SVG 支持颜色覆盖（同款拾色板）


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

