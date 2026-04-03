import type { SemanticRunBundle } from '../semanticAsset'

const KEY = 'flow2go:semantic-runs:v1'

function loadAll(): SemanticRunBundle[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SemanticRunBundle[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAll(items: SemanticRunBundle[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items))
  } catch {}
}

export function saveSemanticRunBundle(bundle: SemanticRunBundle) {
  const all = loadAll()
  all.unshift(bundle)
  saveAll(all.slice(0, 200))
}

export function getSemanticRunBundle(runId: string): SemanticRunBundle | null {
  return loadAll().find((r) => r.id === runId) ?? null
}

export function loadSemanticRunBundles(limit = 20): SemanticRunBundle[] {
  return loadAll().slice(0, Math.max(0, limit))
}

