// API client for Flow2Go backend

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const AUTH_TOKEN_KEY = 'flow2go_auth_token'
const AUTH_USER_KEY = 'flow2go_auth_user'

// ========== Auth helpers ==========

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function getAuthUser(): { userId: string; username: string } | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setAuth(token: string, user: { userId: string; username: string }): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem(AUTH_USER_KEY)
}

export function isLoggedIn(): boolean {
  return !!getAuthToken()
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ========== Auth API ==========

export async function register(username: string, password: string): Promise<{ token: string; userId: string; username: string }> {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '注册失败')
  setAuth(data.token, { userId: data.userId, username: data.username })
  return data
}

export async function login(username: string, password: string): Promise<{ token: string; userId: string; username: string }> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '登录失败')
  setAuth(data.token, { userId: data.userId, username: data.username })
  return data
}

export function logout(): void {
  clearAuth()
}

export type SavedTemplate = {
  id: string
  name: string
  description?: string
  nodes: unknown[]
  edges: unknown[]
  viewport?: { x: number; y: number; zoom: number }
  created_at?: string
  updated_at?: string
}

export type AssetItem = {
  id: string
  name: string
  type: 'svg' | 'png'
  dataUrl: string
  width?: number
  height?: number
}

// ========== Templates API ==========

export async function listTemplates(): Promise<SavedTemplate[]> {
  try {
    const res = await fetch(`${API_URL}/api/templates`, {
      headers: authHeaders(),
    })
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to fetch templates')
    return res.json()
  } catch (err) {
    console.error('API error:', err)
    // Fallback to localStorage
    return getLocalTemplates()
  }
}

export async function getTemplate(id: string): Promise<SavedTemplate | null> {
  try {
    const res = await fetch(`${API_URL}/api/templates/${id}`, {
      headers: authHeaders(),
    })
    if (res.status === 404) return null
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to fetch template')
    return res.json()
  } catch (err) {
    console.error('API error:', err)
    // Fallback to localStorage
    return getLocalTemplate(id)
  }
}

export async function saveTemplate(template: SavedTemplate): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(template),
    })
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to save template')
    // Also save to localStorage as backup
    saveLocalTemplate(template)
  } catch (err) {
    console.error('API error:', err)
    // Fallback to localStorage
    saveLocalTemplate(template)
  }
}

export async function deleteTemplate(id: string): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/api/templates/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    if (!res.ok && res.status !== 404 && res.status !== 401) throw new Error('Failed to delete template')
    // Also delete from localStorage
    deleteLocalTemplate(id)
  } catch (err) {
    console.error('API error:', err)
    deleteLocalTemplate(id)
  }
}

// ========== Assets API ==========

export async function listAssets(): Promise<AssetItem[]> {
  try {
    const res = await fetch(`${API_URL}/api/assets`, {
      headers: authHeaders(),
    })
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to fetch assets')
    const assets = await res.json()
    return assets.map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      dataUrl: a.data_url,
      width: a.width,
      height: a.height,
    }))
  } catch (err) {
    console.error('API error:', err)
    return []
  }
}

export async function saveAsset(asset: AssetItem): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(asset),
    })
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to save asset')
  } catch (err) {
    console.error('API error:', err)
  }
}

export async function deleteAsset(id: string): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/api/assets/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    if (!res.ok && res.status !== 404 && res.status !== 401) throw new Error('Failed to delete asset')
  } catch (err) {
    console.error('API error:', err)
  }
}

// ========== localStorage fallback ==========

const TEMPLATE_KEY = 'flow2go_templates'

function getLocalTemplates(): SavedTemplate[] {
  try {
    const raw = window.localStorage.getItem(TEMPLATE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedTemplate[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getLocalTemplate(id: string): SavedTemplate | null {
  const templates = getLocalTemplates()
  return templates.find(t => t.id === id) || null
}

function saveLocalTemplate(template: SavedTemplate): void {
  try {
    const templates = getLocalTemplates()
    const existing = templates.findIndex(t => t.id === template.id)
    if (existing >= 0) {
      templates[existing] = template
    } else {
      templates.unshift(template)
    }
    window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates))
  } catch {
    // ignore
  }
}

function deleteLocalTemplate(id: string): void {
  try {
    const templates = getLocalTemplates().filter(t => t.id !== id)
    window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates))
  } catch {
    // ignore
  }
}
