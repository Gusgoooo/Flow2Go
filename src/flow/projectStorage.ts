export type ProjectSnapshot = {
  nodes: unknown[]
  edges: unknown[]
  viewport?: { x: number; y: number; zoom: number }
}

export type Project = {
  id: string
  name: string
  updatedAt: number
  snapshot: ProjectSnapshot
}

const PROJECTS_KEY = 'flow2go:projects:v1'
const LAST_PROJECT_KEY = 'flow2go:lastProjectId:v1'

export function loadProjects(): Project[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Project[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveProjects(list: Project[]) {
  try {
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(list))
  } catch {}
}

export function getProject(id: string): Project | null {
  return loadProjects().find((p) => p.id === id) ?? null
}

export function saveProject(project: Project) {
  const list = loadProjects()
  const idx = list.findIndex((p) => p.id === project.id)
  const next = idx >= 0 ? [...list.slice(0, idx), project, ...list.slice(idx + 1)] : [...list, project]
  saveProjects(next)
}

export function loadLastProjectId(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

export function saveLastProjectId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(LAST_PROJECT_KEY, id)
    else window.localStorage.removeItem(LAST_PROJECT_KEY)
  } catch {}
}

export function createProject(
  name: string = 'untitled',
  snapshot?: ProjectSnapshot,
): Project {
  const id = `p-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id,
    name,
    updatedAt: Date.now(),
    snapshot: snapshot ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  }
}
