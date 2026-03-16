import { useEffect, useState } from 'react'
import { loadProjects } from '../flow/projectStorage'
import { listTemplates, type SavedTemplate } from '../api'
import styles from './home.module.css'

type HomeProps = {
  onOpenNew: () => void
  onOpenTemplate: (id: string) => void
  onOpenProject: (projectId: string) => void
  onLogout: () => void
  currentUserName?: string
}

export function Home({ onOpenNew, onOpenTemplate, onOpenProject, onLogout, currentUserName }: HomeProps) {
  const [templates, setTemplates] = useState<SavedTemplate[]>([])
  const [projects, setProjects] = useState(loadProjects())

  useEffect(() => {
    listTemplates().then(setTemplates)
  }, [])

  useEffect(() => {
    setProjects(loadProjects())
  }, [])

  return (
    <div className={styles.homeRoot}>
      <header className={styles.header}>
        <div className={styles.logo}>Flow2Go</div>
        <div className={styles.headerRight}>
          {currentUserName && <span className={styles.user}>你好，{currentUserName}</span>}
          <button type="button" className={styles.logout} onClick={onLogout}>
            退出
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionTitle}>我的项目</h2>
          </div>
          <div className={styles.cardGrid}>
            <button className={`${styles.card} ${styles.newCard}`} type="button" onClick={onOpenNew}>
              <div className={styles.newPlus}>＋</div>
              <div className={styles.cardTitle}>新建画布</div>
              <div className={styles.cardMeta}>空白项目</div>
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.card}
                onClick={() => onOpenProject(p.id)}
              >
                <div className={styles.cardTitle}>{p.name}</div>
                <div className={styles.cardMeta}>
                  {new Date(p.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionTitle}>模板库</h2>
          </div>
          <div className={styles.cardGrid}>
            {templates.length === 0 && (
              <div className={styles.empty}>还没有模板，在画布中点击「保存为模板」后会出现在这里。</div>
            )}
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className={styles.card}
                onClick={() => onOpenTemplate(tpl.id)}
              >
                <div className={styles.cardTitle}>{tpl.name}</div>
                {tpl.description && <div className={styles.cardDesc}>{tpl.description}</div>}
                <div className={styles.cardMeta}>
                  {tpl.updated_at ? new Date(tpl.updated_at).toLocaleString('zh-CN', { hour12: false }) : ''}
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
