import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { watchErrors } from './ui/Feedback'
import './ui/styles.css'
import { noSelect } from './ui/noselect'

// 回報問題時附上最近的錯誤訊息，所以一開始就要開始記
watchErrors()

noSelect() // 遊戲畫面不能長按／右鍵反白（樂園介面設計原則）

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
