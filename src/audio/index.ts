import type { AudioBus, SfxName } from '@/core/types'

/**
 * 音訊模組。遊戲只會叫 audio.play('volley')，不管聲音是檔案還是合成的。
 *
 * 三件骨架就要做完的事：
 * 1. iOS Safari 不准使用者互動前播聲音 → 第一次播放必須綁在使用者的某一下點擊
 * 2. 缺的音效先用 Web Audio 合成，之後補檔案不用改任何呼叫端
 * 3. 教室預設值：音效開、音樂關（一整班同時放音樂會很吵，老師多半會關掉）
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
  // victory 與 defeat 還沒有檔案，下面用合成的頂著
}

/** 沒有檔案的先合成：[頻率, 起始秒, 長度秒] */
const SYNTH: Partial<Record<SfxName, [number, number, number][]>> = {
  victory: [[523, 0, 0.14], [659, 0.13, 0.14], [784, 0.26, 0.14], [1046, 0.39, 0.34]],
  defeat: [[392, 0, 0.18], [330, 0.17, 0.2], [247, 0.36, 0.42]],
}

const BASE = import.meta.env.BASE_URL || '/'
const url = (f: string) => `${BASE}audio/sfx/${f}`.replace(/\/{2,}/g, '/')

export class WebAudioBus implements AudioBus {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private unlocked = false
  private sfxOn = true
  private musicOn = false // 教室預設關
  private music: HTMLAudioElement | null = null

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
    if (!on) {
      this.music?.pause()
      return
    }
    try {
      if (!this.music) {
        this.music = new Audio(`${BASE}audio/music/adventure.mp3`.replace(/\/{2,}/g, '/'))
        this.music.loop = true
        this.music.volume = 0.32
      }
      void this.music.play().catch(() => undefined)
    } catch {
      /* 音樂不是必要的 */
    }
  }

  get isMusicOn(): boolean {
    return this.musicOn
  }
}

export const audio = new WebAudioBus()
