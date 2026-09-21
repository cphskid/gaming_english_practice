import { RULES } from '@/games/tug-of-war/battle'

/**
 * 對戰前的那一頁。
 *
 * 第一版只有電腦對手，而且**老實寫出來是電腦**——小孩被騙到會更不爽，
 * 而且輸給電腦不該記進戰績。好友挑戰與線上配對之後接在同一頁，
 * 對引擎來說都只是換一串答題（見 core/opponent.ts）。
 */
export function Versus({
  myRate, onStart, onBack,
}: {
  /** 我現在大概每分鐘答得完幾題，拿來說明對手有多快 */
  myRate: number
  onStart: (hardness: number, name: string) => void
  onBack: () => void
}) {
  const rate = (h: number) => Math.max(8, Math.min(30, Math.round(myRate * h)))
  const foes: { name: string; hardness: number; desc: string }[] = [
    { name: '見習兵', hardness: 0.75, desc: '比你慢一點，先熟悉怎麼推' },
    { name: '同班同學', hardness: 1.0, desc: '跟你差不多快，會一路拉鋸' },
    { name: '隔壁班高手', hardness: 1.3, desc: '比你快，要專心才推得回去' },
  ]

  return (
    <div className="screen wide">
      <div className="topbar">
        <h2>⚔️ 兵推對戰</h2>
        <span className="spacer" />
        <button className="btn ghost" onClick={onBack}>回選關</button>
      </div>

      <div className="panel vs-intro">
        <p>
          答對一題就派一隻兵往對面走。兩邊的兵在中間打架，誰的兵撐不住，
          <b>前線就往誰那邊退</b>。推到對方城堡就開始打城堡。
        </p>
        <p className="muted">
          一場 {RULES.seconds / 60} 分鐘。時間到的時候，城堡被打得比較兇的人輸；
          城堡一樣就看前線推到哪。<b>答對一次就是一隻兵，按再快也不會變多</b>——
          比的是英文，不是手速。
        </p>
      </div>

      <div className="vs-foes">
        {foes.map((f) => (
          <button key={f.name} className="panel vs-foe" onClick={() => onStart(f.hardness, f.name)}>
            <span className="ic">🤖</span>
            <span className="txt">
              <b>{f.name}</b>
              <small>{f.desc}</small>
              <small className="muted">電腦對手・每分鐘約答對 {rate(f.hardness)} 題</small>
            </span>
            <span className="go">開打</span>
          </button>
        ))}
      </div>

      <p className="vs-note muted">
        打贏電腦不會記進排行榜，金幣和經驗照樣拿得到（那本來就只從答對來）。
      </p>
    </div>
  )
}
