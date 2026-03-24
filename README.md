# Flow2Go

Schema-first AI diagram engine built on React Flow.

## What problem it solves

Most AI diagram tools generate layouts that look acceptable at first glance but are hard to control in real editing workflows.

Flow2Go solves this by using a **schema-first architecture**:
- AI generates structure, not final pixels
- structured output is validated and normalized
- rendering stays stable and editable in React Flow

This makes generated diagrams more predictable, easier to revise, and safer to use in production documentation.

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

## Demo

[link]

## Use cases

- System architecture diagrams
- Agent workflows
- Data pipelines
- Business flows

## Tech

- React Flow (`@xyflow/react`)
- ELK.js + Dagre
- LLM (OpenRouter)
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
- `src/flow/FlowEditor.tsx`
- `src/flow/aiDiagram.ts`
- `src/flow/openRouterClient.ts`
- `src/flow/swimlaneDraft.ts`
- `src/flow/mermaid/*`

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

