# Flow2Go

Flow2Go is a local-first, AI-assisted diagram editor for polished presentation graphics.

Many tools can help people sketch logic quickly. The problem usually appears when the diagram is used in a formal report: structure is correct, but visual quality is not - spacing feels loose, colors are inconsistent, and the overall result looks unrefined.

Most non-designers do not have a clear method to fix these issues. As a designer, I wanted a stricter and repeatable way to make diagrams both usable and visually solid, so I built Flow2Go for my own daily workflow first. If it improves my own speed and quality bar, it should also help other teams.

Flow2Go does not try to be a giant all-in-one tool. It focuses on three practical problems:

1. **Layout difficulty -> Grid snapping system**
2. **Color inconsistency -> Curated presets and fast replacement**
3. **Editing friction -> Minimal interaction model**

It is fully local-first: no cloud data storage by default, safer for sensitive content, and easy to embed in documentation workflows with a borderless canvas style.

## Core Product Principles

### 1) Layout Difficulty -> Grid Snapping

- Canvas editing uses snap-to-grid behavior for consistent rhythm and cleaner alignment.
- The editor keeps diagrams structurally readable without forcing users into manual pixel-level alignment.
- Nodes, groups, and frame containers are designed for fast placement and stable structure.

### 2) Color Difficulty -> Presets + Fast Replacement

- Built-in color choices are intentionally curated for better visual consistency.
- Color editing is quick and repeatable, reducing design overhead for non-designers.
- SVG assets support color override workflows for theme consistency.

### 3) Interaction Friction -> Minimal Editing Model

- Create node -> double-click to edit text -> drag to connect.
- Text editing and edge editing are optimized for direct manipulation.
- Complex operations (grouping, nested structures, re-parenting) are still available without introducing heavy UI complexity.

## Feature Set (Current)

- **Canvas & Graph**
  - Node/edge editing with React Flow-based interaction.
  - Editable bezier and smooth-step edge behavior.
  - Context menus and inline editing for common operations.
  - Borderless canvas look for embedding into docs and reports.

- **Frame & Group Containers**
  - Frames are true containers based on `parentId`.
  - Nested frame/group composition is supported.
  - Drag in/out behavior supports structural re-parenting.

- **Assets**
  - Upload-only asset panel for `SVG` / `PNG`.
  - Drag assets from panel to canvas.
  - Asset transforms: rotation, flip, SVG color override.
  - Asset library persisted locally with project data.

- **Diagram AI Generation**
  - OpenRouter-powered generation path.
  - Scene-aware routing (mind map / flowchart / swimlane).
  - Structured planner + Mermaid conversion + graph materialization pipeline.
  - Progress reporting and retry/fallback handling for stability.

- **Persistence & Portability**
  - Local browser persistence by default.
  - Import/export support including project snapshot + assets.
  - No mandatory cloud storage.

## AI Generation Path (Technical)

Flow2Go's AI path is implemented around these modules:

- `src/flow/FlowEditor.tsx`  
  UI entry, AI modal, progress state, abort/cancel control, and final apply-to-canvas behavior.

- `src/flow/aiDiagram.ts`  
  Main orchestration pipeline:
  - scene routing
  - layout profile selection
  - planner JSON generation
  - Mermaid generation
  - Mermaid parsing/transpiling
  - normalization/materialization into editor snapshot

- `src/flow/openRouterClient.ts`  
  OpenRouter transport strategy:
  - proxy-first call (`VITE_OPENROUTER_PROXY_BASE`, default `/openrouter-proxy`)
  - fallback to direct OpenRouter API when API key is available
  - retryability rules on specific gateway/proxy statuses

- `src/flow/swimlaneDraft.ts` + `src/flow/mermaid/*`  
  Swimlane and Mermaid conversion/materialization internals.

### AI Request/Execution Notes

- Default API base path supports reverse-proxy deployment.
- API key can be supplied from local UI config.
- Long-input scenarios use extended timeout logic and complexity guards.
- Scene capsules can force specific generation pipelines.

## Open-Source Dependencies

### Runtime

- `react`, `react-dom`
- `@xyflow/react` (canvas graph editor foundation)
- `@floating-ui/react` (floating interactions/popups)
- `lucide-react` (icons)
- `react-colorful` (color picker UI)
- `dagre` (layout)
- `elkjs` (layout algorithms)
- `mind-elixir` (mind-map related flow)
- `jszip` (import/export packaging)

### Development

- `vite`, `@vitejs/plugin-react`
- `typescript`
- `eslint`, `typescript-eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`
- `vitest`

## Project Structure (High-Level)

- `src/main.tsx` - app bootstrap
- `src/App.tsx` - top-level app composition + project loading
- `src/flow/` - main editor domain (nodes, edges, layout, persistence, AI, assets)
- `src/flow/mermaid/` - Mermaid parse/transpile/materialize path

## Local-First Data Model

- Project/session data is saved in browser storage by default.
- AI key/settings are local to the current browser context.
- Clearing browser data may remove unsaved projects.
- Recommended: regularly export local backup files.

## Getting Started

### Install

```bash
npm install
```

### Run development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - type-check and create production build
- `npm run preview` - preview built output
- `npm run lint` - run lint checks
- `npm run test` - run tests

## Build

```bash
npm run build
```

Output directory: `dist/`

## Docker (Optional)

```bash
docker build -t flow2go .
docker run --rm -p 8080:80 flow2go
```

Then open [http://localhost:8080](http://localhost:8080).

