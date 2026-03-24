# Flow2Go

Flow2Go is a browser-based diagram editor built with `@xyflow/react` (React Flow).  
It is designed for Figma-like canvas workflows: nodes, edges, frame containers, assets, grouping, and fast editing on large diagrams.

## What You Can Do

- Build diagrams with draggable nodes and editable edges.
- Use **Frame containers** with real parent-child relationships (`parentId`), not visual-only grouping.
- Nest frames and groups, and re-parent elements by dragging in/out of containers.
- Edit edge labels, edge styles, arrows, colors, and widths.
- Upload **SVG/PNG assets** and drag them directly onto the canvas.
- Apply asset transforms such as rotation and flip, with SVG color override support.
- Save/export and import projects (including assets) for local backup and sharing.
- Generate diagrams with AI (optional OpenRouter-based workflow).

## Tech Stack

- React 19
- TypeScript
- Vite
- `@xyflow/react`
- Vitest + ESLint

## Getting Started

### 1) Install dependencies

```bash
npm install
```

### 2) Start development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Available Scripts

- `npm run dev` — start local dev server
- `npm run build` — type-check and build production bundle
- `npm run preview` — preview the production build locally
- `npm run lint` — run ESLint
- `npm run test` — run Vitest tests

## Data Persistence

Flow2Go stores working data in browser storage by default.

- Project state is persisted locally in the browser.
- Clearing browser data may remove unsaved work.
- Export your project regularly for backup.

## Assets

- Supported upload formats: `SVG`, `PNG`
- Assets can be dragged from the asset panel into the canvas.
- Asset panel supports local management (upload/delete) and quick editing after placement.

## AI Features (Optional)

Flow2Go includes optional AI-powered diagram generation.

- Requires an OpenRouter API key.
- API key is stored in browser local storage on your machine.
- Avoid sending sensitive company or personal data in prompts.

## Build for Production

```bash
npm run build
```

Build output is generated in `dist/`.

## Docker (Optional)

Use Docker to run the production build with Nginx:

```bash
docker build -t flow2go .
docker run --rm -p 8080:80 flow2go
```

Open [http://localhost:8080](http://localhost:8080).

