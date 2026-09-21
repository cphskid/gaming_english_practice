import type { AudioBus, MusicName, SfxName } from '@/core/types'

/**
 * 音訊模組。遊戲只會叫 audio.play('volley')，不管聲音是檔案還是合成的。
 *
 * 三件骨架就要做完的事：
 * 1. iOS Safari 不准使用者互動前播聲音 → 第一次播放必須綁在使用者的某一下點擊
 * 2. 缺的音效先用 Web Audio 合成，之後補檔案不用改任何呼叫端
 * 3. 教室吵不吵：音效一律開；**音樂只在對戰那三分鐘放**，關卡裡不放。
 *    一整班同時放十幾分鐘的背景音樂老師一定關掉，但一場三分鐘的對決
 *    需要那個儀式感（Chuck 的原話：開戰號角、熱血 BGM）。
 *    開關記在這台裝置上，孩子自己在「我的設定」關得掉。
 */

/** 有檔案的音效。檔名對應表見 assets/audio/README.md */
const FILES: Partial<Record<SfxName, string[]>> = {
  'answer-correct': ['answer-correct.wav'],
  'answer-wrong': ['answer-wrong.wav'],
  volley: ['volley-1.wav', 'volley-2.wav', 'volley-3.wav'],
  'enemy-hit': ['enemy-hit.wav'],
  'enemy-die': ['enemy-die.wav'],
  'castle-hit': ['castle-hit.wav'],
  'tower-build': ['tower-build.wav'],
  'tower-sell': ['tower-sell.wav'],
  'wave-start': ['wave-start.wav'],
  star: ['star.wav'],
  coin: ['coin.wav'],
  'ui-tap': ['ui-tap.wav'],
  explosion: ['explosion.wav'],
  'battle-horn': ['battle-horn.ogg'],
  // victory 與 defeat 還沒有檔案，下面用合成的頂著
}

/** 沒有檔案的先合成：[頻率, 起始秒, 長度秒] */
const SYNTH: Partial<Record<SfxName, [number, number, number][]>> = {
  victory: [[523, 0, 0.14], [659, 0.13, 0.14], [784, 0.26, 0.14], [1046, 0.39, 0.34]],
  defeat: [[392, 0, 0.18], [330, 0.17, 0.2], [247, 0.36, 0.42]],
}

/** 開關記在這台裝置上。讀不到（無痕、擋了儲存）就用預設值，不要讓遊戲掛掉。 */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem('audio.' + key)
    return v === null ? fallback : v === '1'
  } catch { return fallback }
}

function writeFlag(key: string, on: boolean): void {
  try { localStorage.setItem('audio.' + key, on ? '1' : '0') } catch { /* 記不起來就算了 */ }
}

const BASE = import.meta.env.BASE_URL || '/'
const url = (f: string) => `${BASE}audio/sfx/${f}`.replace(/\/{2,}/g, '/')

export class WebAudioBus implements AudioBus {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private unlocked = false
  private sfxOn = true
  private musicOn = readFlag('music', true)
  private music: HTMLAudioElement | null = null
  private track: MusicName | null = null

  /** 綁在使用者的第一下點擊。重複呼叫沒有副作用。 */
  unlock(): void {
    if (this.unlocked) return
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
      // iOS 要在使用者手勢裡播一個無聲的音，之後才准自動播
      const s = this.ctx.createBufferSource()
      s.buffer = this.ctx.createBuffer(1, 1, 22050)
      s.connect(this.ctx.destination)
      s.start(0)
      void this.ctx.resume()
      this.unlocked = true
      void this.preload()
    } catch {
      this.unlocked = true // 沒有 Web Audio 就安靜跑，不要讓遊戲掛掉
    }
  }

  private async preload(): Promise<void> {
    const files = [...new Set(Object.values(FILES).flat())] as string[]
    await Promise.all(files.map((f) => this.load(f)))
  }

  private async load(file: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null
    const hit = this.buffers.get(file)
    if (hit) return hit
    try {
      const res = await fetch(url(file))
      if (!res.ok) return null
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
      this.buffers.set(file, buf)
      return buf
    } catch {
      return null
    }
  }

  play(name: SfxName): void {
    if (!this.sfxOn || !this.ctx) return
    const files = FILES[name]
    if (files?.length) {
      const file = files[(Math.random() * files.length) | 0]
      const buf = this.buffers.get(file)
      if (buf) return this.playBuffer(buf)
      void this.load(file).then((b) => b && this.playBuffer(b))
      return
    }
    const notes = SYNTH[name]
    if (notes) this.playSynth(notes)
  }

  private playBuffer(buf: AudioBuffer): void {
    if (!this.ctx) return
    try {
      const src = this.ctx.createBufferSource()
      const gain = this.ctx.createGain()
      gain.gain.value = 0.75
      src.buffer = buf
      src.connect(gain).connect(this.ctx.destination)
      src.start(0)
    } catch {
      /* 播不出來就安靜 */
    }
  }

  /** 方波小調子，聽起來像 8-bit，跟像素美術不衝突 */
  private playSynth(notes: [number, number, number][]): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const [freq, at, dur] of notes) {
      try {
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'square'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, now + at)
        gain.gain.exponentialRampToValueAtTime(0.16, now + at + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur)
        osc.connect(gain).connect(this.ctx.destination)
        osc.start(now + at)
        osc.stop(now + at + dur + 0.02)
      } catch {
        /* 同上 */
      }
    }
  }

  setSfxEnabled(on: boolean): void {
    this.sfxOn = on
  }

  setMusicEnabled(on: boolean): void {
    this.musicOn = on
    writeFlag('music', on)
    if (!on) this.stopMusic()
    else if (this.track) this.playMusic(this.track)
  }

  /**
   * 換一首，或停掉。
   *
   * 音樂走 HTMLAudioElement 不走 Web Audio：曲子是邊下載邊播的，
   * 不用像音效那樣先整個抓下來解碼（學校共用 WiFi，那首曲子快一 MB）。
   */
  playMusic(track: MusicName | null): void {
    this.track = track
    if (!track) return this.stopMusic()
    if (!this.musicOn) return
    try {
      const src = `${BASE}audio/music/${track}.ogg`.replace(/\/{2,}/g, '/')
      if (!this.music) {
        this.music = new Audio(src)
        this.music.loop = true
        this.music.volume = 0.3
      } else if (!this.music.src.endsWith(`${track}.ogg`)) {
        this.music.src = src
      }
      this.music.playbackRate = 1
      this.music.currentTime = 0    // 新的一場從頭放；暫停／繼續走 pauseMusic
      void this.music.play().catch(() => undefined)
    } catch {
      /* 音樂不是必要的，播不出來也要照玩 */
    }
  }

  pauseMusic(on: boolean): void {
    if (!this.music || !this.musicOn || !this.track) return
    try {
      if (on) this.music.pause()
      else void this.music.play().catch(() => undefined)
    } catch { /* 同上 */ }
  }

  setMusicRate(rate: number): void {
    if (!this.music) return
    try { this.music.playbackRate = rate } catch { /* 不支援就算了 */ }
  }

  private stopMusic(): void {
    try { this.music?.pause() } catch { /* 同上 */ }
  }

  get isMusicOn(): boolean {
    return this.musicOn
  }
}

export const audio = new WebAudioBus()
