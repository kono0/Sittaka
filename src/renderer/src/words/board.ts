import type { Speaker } from '../audio/capture'

export interface TermInput {
  text: string
  reading?: string
}

export interface BoardWord {
  text: string
  reading?: string
  speaker: Speaker
  /** その言葉が出たときの会話（意味を調べるときに AI に渡す） */
  context: string[]
  meaning?:
    | { state: 'loading' }
    | { state: 'done'; word: string; reading: string; text: string }
    | { state: 'error'; text: string }
  /** 会話の中で出てきた回数 */
  count: number
  lastSeen: number
  keptAt: number | null
}

/** 会話から拾った言葉の一覧と、キープした言葉を持つ */
export class WordBoard {
  private words = new Map<string, BoardWord>()

  constructor(private readonly maxRecent = 40) {}

  add(terms: TermInput[], speaker: Speaker, now: number, context: string[] = []): void {
    for (const t of terms) {
      const w = this.words.get(t.text)
      if (w) {
        // 同じ言葉がまた出たら、一覧の先頭に戻す
        w.count++
        w.lastSeen = now
        w.speaker = speaker
        w.context = context
      } else {
        this.words.set(t.text, { ...t, speaker, context, count: 1, lastSeen: now, keptAt: null })
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

  get(text: string): BoardWord | undefined {
    return this.words.get(text)
  }

  /** キープしたら true（すでにキープ済みなら false） */
  keep(text: string, now: number): boolean {
    const w = this.words.get(text)
    if (!w || w.keptAt !== null) return false
    w.keptAt = now
    return true
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
