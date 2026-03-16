# Flow2Go（React Flow 大图生成器）

目标：先做一个“全量功能版本”的编辑器壳，**完全继承 React Flow 的能力**（节点/边、拖拽连线、选择/多选、缩放平移、MiniMap、Controls、Background 等），后续再按你的需求做定制与精简。

## 本地运行（不使用 Docker）

```bash
cd flow2go
npm install
npm run dev
```

打开 `http://localhost:5173`。

## 本地 Docker 运行（推荐）

### 开发模式（热更新）

```bash
cd flow2go
docker compose up --build flow2go-dev
```

打开 `http://localhost:5173`。

### 生产模式（Nginx 静态托管）

```bash
cd flow2go
docker compose up --build flow2go-prod
```

打开 `http://localhost:8080`。

## 目前包含的能力

- 拖拽节点库到画布创建节点
- 画布内连线创建边
- MiniMap / Controls / Background
- 选中节点/边后在右侧属性面板修改 label、边动画等
- 导出：复制 JSON 到剪贴板
- 导入：粘贴 JSON 覆盖当前画布
- 自动保存：写入浏览器 `localStorage`（刷新不丢）

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
