import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './flow/overview/xy-theme.css'
import './index.css'
import App from './App.tsx'

// 生产环境某些托管平台会注入 <base>，会导致 SVG 内部 url(#...) 引用失效（例如 React Flow 的箭头 marker）。
// 为避免“发布后箭头丢失”，在启动时移除 base 标签。
const baseEl = document.querySelector('base')
if (baseEl) baseEl.remove()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
