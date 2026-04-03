# Flow2Go

Schema-first AI diagram engine built on React Flow.

## What problem it solves

Most AI diagram tools generate layouts that look acceptable at first glance but are hard to control in real editing workflows.

Flow2Go solves this by using a **schema-first architecture**:
- AI generates structure, not final pixels
- structured output is validated and normalized
- rendering stays stable and editable in React Flow

This makes generated diagrams more predictable, easier to revise, and safer to use in production documentation.

## Demo

https://flow2go-nine.vercel.app/
![Flow2Go Screenshot](docs/assets/%E6%88%AA%E5%B1%8F2026-03-24%2020.04.35.png)

## Key Features

- Natural language -> structured diagram (JSON schema pipeline)
- Multi-layout support (Flow / Swimlane / Mindmap)
- React Flow-compatible rendering and editing
- ELK/Dagre-based layout optimization to reduce edge crossing
- Local-first persistence (no mandatory cloud storage)
- Asset workflow (SVG/PNG upload, drag-to-canvas, transform support)

## Why it's different

- Not AI-first, but **Schema-first**
- AI operates on structure, planning, and constraints
- Stable, controllable, extensible generation pipeline
- Deterministic post-processing before canvas materialization

## Use cases

- System architecture diagrams
- Agent workflows
- Data pipelines
- Business flows

## Tech

- React Flow (`@xyflow/react`)
- ELK.js + Dagre
- 模型网关（Routify OpenAI 兼容，统一路由）
- React + TypeScript + Vite
- Mermaid parse/transpile/materialize toolchain

## AI generation path

1. Prompt input in editor
2. Scene routing (Flow / Swimlane / Mindmap)
3. Layout profile decision
4. Planner JSON generation
5. Mermaid generation and parsing
6. Schema validation + normalization
7. Snapshot materialization to React Flow nodes/edges

Related modules:
- `src/flow/routifyClient.ts`（**所有模型 HTTP 调用的唯一出口**：`post` / `chatCompletions` / …）
- `src/flow/FlowEditor.tsx`
- `src/flow/aiDiagram.ts`
- `src/flow/openRouterClient.ts`（兼容封装，内部走 Routify）
- `src/flow/swimlaneDraft.ts`
- `src/flow/mermaid/*`

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### AI / LLM（Routify）

统一路由为 OpenAI 兼容协议：

- Base URL: `https://routify.alibaba-inc.com/protocol/openai/v1`
- Chat: `.../chat/completions`
- 鉴权：`Authorization: Bearer <key>`
- **本地开发**：浏览器直连上述外网地址会被 **CORS** 拦截（控制台常见 `Failed to fetch`）；项目在 `localhost` / `127.0.0.1` 下会改用同源路径 `/protocol/openai/v1`，由 Vite **开发/预览代理**转发到 Routify。修改 `vite.config.ts` 后需重启 `npm run dev`。生产环境若静态站点仍跨域，需在网关侧放行 CORS，或设置 `VITE_ROUTIFY_BASE_URL` 指向自有反代。

如果你是 GitLab Pages/快速部署平台这类**纯静态托管**（无法运行 Nginx 反代），通常需要外部代理来解决 CORS。可参考：
- `docs/routify-proxy/cloudflare-worker.md`

环境变量（不要提交真实密钥）：

| 场景 | 变量名 |
|------|--------|
| Vite 前端构建 / 本地开发 | `VITE_ROUTIFY_API_KEY` |
| Node / serverless（如 `api/` 代理） | `ROUTIFY_API_KEY` |

底层封装见 `src/flow/routifyClient.ts`（`routifyOpenAICompatible.post('子路径', { body })` 可覆盖 chat / images / embeddings 等所有兼容端点）。业务侧通过 `aiDiagram.ts` 等模块调用，**不要在页面或业务 handler 里直接写外部模型 URL**。

