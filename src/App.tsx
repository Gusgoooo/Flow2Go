import { useEffect, useState } from 'react'
import './App.css'
import FlowEditor from './flow/editor/FlowEditor'
import {
  getProject,
  loadLastProjectId,
  saveLastProjectId,
  createProject,
  saveProject,
} from './flow/persistence/projectStorage'

function App() {
  const [projectId, setProjectId] = useState<string | null>(null)

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

  if (!projectId) {
    return <div className="appLoading">加载中...</div>
  }

  return (
    <div className="appRoot">
      <FlowEditor
        source={{ kind: 'project', projectId }}
      />
    </div>
  )
}

export default App
