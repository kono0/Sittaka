import type { Speaker } from '../audio/capture'

export interface TermInput {
  text: string
  reading?: string
}

export interface BoardWord {
  text: string
  reading?: string
  speaker: Speaker
  /** 会話の中で出てきた回数 */
  count: number
  lastSeen: number
  keptAt: number | null
}

/** 会話から拾った言葉の一覧と、キープした言葉を持つ */
export class WordBoard {
  private words = new Map<string, BoardWord>()

  constructor(private readonly maxRecent = 40) {}

  add(terms: TermInput[], speaker: Speaker, now: number): void {
    for (const t of terms) {
      const w = this.words.get(t.text)
      if (w) {
        // 同じ言葉がまた出たら、一覧の先頭に戻す
        w.count++
        w.lastSeen = now
        w.speaker = speaker
      } else {
        this.words.set(t.text, { ...t, speaker, count: 1, lastSeen: now, keptAt: null })
      }
    }
    this.trim()
  }

  /** キープしていない言葉を新しい順に */
  recent(): BoardWord[] {
    return [...this.words.values()].filter((w) => w.keptAt === null).sort((a, b) => b.lastSeen - a.lastSeen)
  }

  /** キープした言葉を、キープした順に */
  kept(): BoardWord[] {
    return [...this.words.values()].filter((w) => w.keptAt !== null).sort((a, b) => a.keptAt! - b.keptAt!)
  }

  keep(text: string, now: number): void {
    const w = this.words.get(text)
    if (w && w.keptAt === null) w.keptAt = now
  }

  unkeep(text: string): void {
    const w = this.words.get(text)
    if (w) w.keptAt = null
    this.trim()
  }

  clear(): void {
    this.words.clear()
  }

  private trim(): void {
    // キープしたものは消さない。それ以外は古いものから捨てる
    for (const w of this.recent().slice(this.maxRecent)) this.words.delete(w.text)
  }
}
