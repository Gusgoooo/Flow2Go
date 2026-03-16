import { useState } from 'react'
import styles from './auth.module.css'
import { login, register, getAuthUser, logout as apiLogout } from '../api'

export type User = {
  userId: string
  username: string
}

export function loadCurrentUser(): User | null {
  return getAuthUser()
}

export function logout() {
  apiLogout()
}

type AuthProps = {
  onSignedIn: (user: User) => void
}

type Mode = 'signin' | 'signup'

export function Auth({ onSignedIn }: AuthProps) {
  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError('')
  }

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault()
    const u = username.trim()
    const p = password
    if (!u || !p) {
      setError('花名和密码都不能为空')
      return
    }
    if (p.length < 4) {
      setError('密码至少 4 位')
      return
    }
    
    setLoading(true)
    setError('')
    
    try {
      if (mode === 'signup') {
        const result = await register(u, p)
        onSignedIn({ userId: result.userId, username: result.username })
      } else {
        const result = await login(u, p)
        onSignedIn({ userId: result.userId, username: result.username })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.authRoot}>
      <div className={styles.panel}>
        <div className={styles.logo}>Flow2Go</div>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${mode === 'signin' ? styles.tabActive : ''}`}
            onClick={() => switchMode('signin')}
          >
            登录
          </button>
          <button
            type="button"
            className={`${styles.tab} ${mode === 'signup' ? styles.tabActive : ''}`}
            onClick={() => switchMode('signup')}
          >
            注册
          </button>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <div className={styles.label}>花名</div>
            <input
              className={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="例如：阿土"
              disabled={loading}
            />
          </label>
          <label className={styles.field}>
            <div className={styles.label}>密码</div>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 4 位"
              disabled={loading}
            />
          </label>
          {error && <div className={styles.error}>{error}</div>}
          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? '请稍候...' : mode === 'signin' ? '登录' : '注册并登录'}
          </button>
        </form>
      </div>
    </div>
  )
}

