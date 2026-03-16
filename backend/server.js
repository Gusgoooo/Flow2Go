import express from 'express'
import cors from 'cors'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// JWT secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'flow2go-secret-key-change-in-production'

// Simple JWT implementation
function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url')
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

function verifyToken(token) {
  try {
    const [header, body, signature] = token.split('.')
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')
    if (signature !== expectedSig) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

// Simple password hashing
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + JWT_SECRET).digest('hex')
}

// Initialize database
const dbPath = process.env.DB_PATH || join(__dirname, 'data', 'flow2go.db')
const db = new Database(dbPath)

// Create tables with user_id
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    nodes TEXT NOT NULL,
    edges TEXT NOT NULL,
    viewport TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    data_url TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    nodes TEXT NOT NULL,
    edges TEXT NOT NULL,
    viewport TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`)

// Add user_id column if not exists (migration for existing tables)
try {
  db.exec(`ALTER TABLE templates ADD COLUMN user_id TEXT DEFAULT 'legacy'`)
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE assets ADD COLUMN user_id TEXT DEFAULT 'legacy'`)
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE projects ADD COLUMN user_id TEXT DEFAULT 'legacy'`)
} catch (e) { /* column already exists */ }

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }
  const token = authHeader.slice(7)
  const payload = verifyToken(token)
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  req.userId = payload.userId
  req.username = payload.username
  next()
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ========== Auth API ==========

// Register
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password } = req.body
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    
    if (username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: '用户名长度需要在2-20个字符之间' })
    }
    
    if (password.length < 4) {
      return res.status(400).json({ error: '密码长度至少4个字符' })
    }
    
    // Check if username exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existing) {
      return res.status(400).json({ error: '用户名已存在' })
    }
    
    const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const passwordHash = hashPassword(password)
    
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .run(userId, username, passwordHash)
    
    const token = createToken({ userId, username })
    
    res.status(201).json({ token, userId, username })
  } catch (err) {
    console.error('Error registering:', err)
    res.status(500).json({ error: '注册失败' })
  }
})

// Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body
    
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }
    
    const passwordHash = hashPassword(password)
    if (user.password_hash !== passwordHash) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }
    
    const token = createToken({ userId: user.id, username: user.username })
    
    res.json({ token, userId: user.id, username: user.username })
  } catch (err) {
    console.error('Error logging in:', err)
    res.status(500).json({ error: '登录失败' })
  }
})

// Get current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ userId: req.userId, username: req.username })
})

// ========== Templates API ==========

// List user's templates
app.get('/api/templates', authMiddleware, (req, res) => {
  try {
    const templates = db.prepare(`
      SELECT id, name, description, nodes, edges, viewport, created_at, updated_at 
      FROM templates 
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(req.userId)
    
    const result = templates.map(t => ({
      ...t,
      nodes: JSON.parse(t.nodes),
      edges: JSON.parse(t.edges),
      viewport: t.viewport ? JSON.parse(t.viewport) : null,
    }))
    
    res.json(result)
  } catch (err) {
    console.error('Error listing templates:', err)
    res.status(500).json({ error: 'Failed to list templates' })
  }
})

// Get single template (user must own it)
app.get('/api/templates/:id', authMiddleware, (req, res) => {
  try {
    const template = db.prepare(`
      SELECT * FROM templates WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId)
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' })
    }
    
    res.json({
      ...template,
      nodes: JSON.parse(template.nodes),
      edges: JSON.parse(template.edges),
      viewport: template.viewport ? JSON.parse(template.viewport) : null,
    })
  } catch (err) {
    console.error('Error getting template:', err)
    res.status(500).json({ error: 'Failed to get template' })
  }
})

// Create template
app.post('/api/templates', authMiddleware, (req, res) => {
  try {
    const { id, name, description, nodes, edges, viewport } = req.body
    
    if (!id || !name || !nodes || !edges) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    
    db.prepare(`
      INSERT INTO templates (id, user_id, name, description, nodes, edges, viewport)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.userId,
      name,
      description || '',
      JSON.stringify(nodes),
      JSON.stringify(edges),
      viewport ? JSON.stringify(viewport) : null
    )
    
    res.status(201).json({ id, name, description })
  } catch (err) {
    console.error('Error creating template:', err)
    res.status(500).json({ error: 'Failed to create template' })
  }
})

// Delete template (user must own it)
app.delete('/api/templates/:id', authMiddleware, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.userId)
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Template not found' })
    }
    
    res.json({ success: true })
  } catch (err) {
    console.error('Error deleting template:', err)
    res.status(500).json({ error: 'Failed to delete template' })
  }
})

// ========== Assets API ==========

// List user's assets
app.get('/api/assets', authMiddleware, (req, res) => {
  try {
    const assets = db.prepare(`
      SELECT * FROM assets WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.userId)
    
    res.json(assets)
  } catch (err) {
    console.error('Error listing assets:', err)
    res.status(500).json({ error: 'Failed to list assets' })
  }
})

// Create asset
app.post('/api/assets', authMiddleware, (req, res) => {
  try {
    const { id, name, type, dataUrl, width, height } = req.body
    
    if (!id || !name || !type || !dataUrl) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    
    db.prepare(`
      INSERT INTO assets (id, user_id, name, type, data_url, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.userId, name, type, dataUrl, width || null, height || null)
    
    res.status(201).json({ id, name, type })
  } catch (err) {
    console.error('Error creating asset:', err)
    res.status(500).json({ error: 'Failed to create asset' })
  }
})

// Delete asset (user must own it)
app.delete('/api/assets/:id', authMiddleware, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM assets WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.userId)
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Asset not found' })
    }
    
    res.json({ success: true })
  } catch (err) {
    console.error('Error deleting asset:', err)
    res.status(500).json({ error: 'Failed to delete asset' })
  }
})

// ========== Projects API ==========

// List user's projects
app.get('/api/projects', authMiddleware, (req, res) => {
  try {
    const projects = db.prepare(`
      SELECT id, name, created_at, updated_at FROM projects 
      WHERE user_id = ? 
      ORDER BY updated_at DESC
    `).all(req.userId)
    
    res.json(projects)
  } catch (err) {
    console.error('Error listing projects:', err)
    res.status(500).json({ error: 'Failed to list projects' })
  }
})

// Get single project (user must own it)
app.get('/api/projects/:id', authMiddleware, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId)
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }
    
    res.json({
      ...project,
      nodes: JSON.parse(project.nodes),
      edges: JSON.parse(project.edges),
      viewport: project.viewport ? JSON.parse(project.viewport) : null,
    })
  } catch (err) {
    console.error('Error getting project:', err)
    res.status(500).json({ error: 'Failed to get project' })
  }
})

// Create or update project
app.put('/api/projects/:id', authMiddleware, (req, res) => {
  try {
    const { name, nodes, edges, viewport } = req.body
    const { id } = req.params
    
    if (!name || !nodes || !edges) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    
    const existing = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
      .get(id, req.userId)
    
    if (existing) {
      db.prepare(`
        UPDATE projects 
        SET name = ?, nodes = ?, edges = ?, viewport = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(
        name,
        JSON.stringify(nodes),
        JSON.stringify(edges),
        viewport ? JSON.stringify(viewport) : null,
        id,
        req.userId
      )
    } else {
      db.prepare(`
        INSERT INTO projects (id, user_id, name, nodes, edges, viewport)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        req.userId,
        name,
        JSON.stringify(nodes),
        JSON.stringify(edges),
        viewport ? JSON.stringify(viewport) : null
      )
    }
    
    res.json({ id, name })
  } catch (err) {
    console.error('Error saving project:', err)
    res.status(500).json({ error: 'Failed to save project' })
  }
})

// Delete project (user must own it)
app.delete('/api/projects/:id', authMiddleware, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.userId)
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Project not found' })
    }
    
    res.json({ success: true })
  } catch (err) {
    console.error('Error deleting project:', err)
    res.status(500).json({ error: 'Failed to delete project' })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Flow2Go API server running on port ${PORT}`)
})
