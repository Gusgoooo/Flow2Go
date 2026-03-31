import { useEffect, useState } from 'react'
import './App.css'
import FlowEditor from './flow/FlowEditor'
import {
  getProject,
  loadLastProjectId,
  saveLastProjectId,
  createProject,
  saveProject,
} from './flow/projectStorage'

const FIRST_VISIT_KEY = 'flow2go_first_visit'

function WelcomeTip({ onClose }: { onClose: () => void }) {
  return (
    <div className="welcomeOverlay" onClick={onClose}>
      <div className="welcomePanel" onClick={(e) => e.stopPropagation()}>
        <div className="welcomeIcon">📋</div>
        <div className="welcomeTitle">欢迎使用 Flow2Go</div>
        <div className="welcomeText">
          这是一个即用即走的流程图工具。
          <br /><br />
          <strong>⚠️ 重要提示：</strong>
          <br />
          您的数据仅保存在浏览器中，清除浏览器数据会丢失内容。
          <br /><br />
          请使用工具栏的 <strong>「保存到本地」</strong> 按钮将作品保存到本地！
        </div>
        <button type="button" className="welcomeBtn" onClick={onClose}>
          我知道了，开始使用
        </button>
      </div>
    </div>
  )
}

function App() {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return !localStorage.getItem(FIRST_VISIT_KEY)
    } catch {
      return false
    }
  })

  useEffect(() => {
    // Load or create project
    const lastId = loadLastProjectId()
    let proj = lastId ? getProject(lastId) : null
    
    if (!proj) {
      // Create default project
      proj = createProject('Flow2Go')
      saveProject(proj)
      saveLastProjectId(proj.id)
    }
    
    setProjectId(proj.id)

    // Add beforeunload warning
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '您有未保存的更改，确定要离开吗？请先导出文件保存您的作品！'
      return e.returnValue
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  const handleCloseWelcome = () => {
    localStorage.setItem(FIRST_VISIT_KEY, 'true')
    setShowWelcome(false)
  }

  if (!projectId) {
    return <div className="appLoading">加载中...</div>
  }

  return (
    <div className="appRoot">
      <FlowEditor
        source={{ kind: 'project', projectId }}
      />
      {showWelcome && <WelcomeTip onClose={handleCloseWelcome} />}
    </div>
  )
}

export default App
