import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { watchErrors } from './ui/Feedback'
import './ui/styles.css'

// 回報問題時附上最近的錯誤訊息，所以一開始就要開始記
watchErrors()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
