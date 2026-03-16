export type PersistedFlowState = {
  version: 1
  savedAt: number
  nodes: unknown[]
  edges: unknown[]
  viewport?: { x: number; y: number; zoom: number }
}

const STORAGE_KEY = 'flow2go:graph:v1'

export function loadPersistedState(): PersistedFlowState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedFlowState
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null
    return parsed
  } catch {
    return null
  }
}

export function savePersistedState(next: PersistedFlowState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function clearPersistedState() {
  localStorage.removeItem(STORAGE_KEY)
}

