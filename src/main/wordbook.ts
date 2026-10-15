import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

export interface WordbookEntry {
  word: string
  reading?: string
  meaning?: string
  /** その言葉が出た会話の一部 */
  context: string
  savedAt: string
}

/** キープした言葉を、通話のあとで見返せるようにファイルに残す */
export class Wordbook {
  private entries: WordbookEntry[]
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {
    try {
      this.entries = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as WordbookEntry[]) : []
    } catch {
      this.entries = []
    }
  }

  list(): WordbookEntry[] {
    return [...this.entries].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  /** 同じ言葉は1件にまとめ、新しい意味と会話で上書きする */
  save(entry: WordbookEntry): Promise<void> {
    const i = this.entries.findIndex((e) => e.word === entry.word)
    if (i >= 0) this.entries[i] = { ...this.entries[i], ...stripEmpty(entry) }
    else this.entries.push(entry)
    return this.flush()
  }

  remove(word: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.word !== word)
    return this.flush()
  }

  private flush(): Promise<void> {
    // 書き込みが重ならないよう順番に行う
    const data = JSON.stringify(this.entries, null, 2)
    this.writing = this.writing.then(() => writeFile(this.file, data))
    return this.writing
  }
}

function stripEmpty(e: WordbookEntry): Partial<WordbookEntry> {
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && v !== '')) as Partial<WordbookEntry>
}
