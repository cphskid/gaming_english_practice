import type { SessionResult } from '@/core/session'

export function Result({
  result, bonus, onRetry, onBack,
}: {
  result: SessionResult
  bonus: { coins: number; exp: number }
  onRetry: () => void
  onBack: () => void
}) {
  const me = result.scores[0]
  const acc = me && me.asked ? Math.round((me.correct / me.asked) * 100) : 0
  // 對戰沒有關卡，所以沒有星星。照樣畫三顆空星會讓人以為自己打得很爛。
  const versus = result.levelId === null

  return (
    <div className="screen">
      <div className="result panel">
        <h1>
          {versus
            ? (result.outcome.win ? '贏了！' : '這場輸了')
            : (result.outcome.win ? '守住了！' : '城堡被攻破了')}
        </h1>
        {versus
          ? <div className="stars">{result.outcome.win ? '🏆' : '⚔️'}</div>
          : <div className="stars">{'★'.repeat(result.stars)}{'☆'.repeat(3 - result.stars)}</div>}
        <p className="lede">{result.outcome.detail}</p>
        <div className="rows">
          <div className="row"><span>答對</span><b>{me?.correct ?? 0} / {me?.asked ?? 0} 題（{acc}%）</b></div>
          <div className="row"><span>最長連擊</span><b>{me?.bestCombo ?? 0}</b></div>
          <div className="row"><span>獲得銅幣</span><b>🪙 {bonus.coins}</b></div>
          <div className="row"><span>獲得經驗</span><b>{bonus.exp} exp</b></div>
          {result.bonusCoins > 0 && (
            <div className="row"><span>首次通關獎勵</span><b>🪙 {result.bonusCoins}</b></div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn ghost" onClick={onBack}>回選關</button>
          <button className="btn" onClick={onRetry}>{versus ? '再來一場' : '再玩一次'}</button>
        </div>
      </div>
    </div>
  )
}
