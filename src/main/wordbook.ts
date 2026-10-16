import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

export interface WordbookEntry {
  word: string
  reading?: string
  meaning?: string
  /** その言葉が出た会話の一部 */
  context: string
  savedAt: string
  /** 入れたフォルダ（なければ未分類） */
  folder?: string
}

export interface WordbookData {
  folders: string[]
  entries: WordbookEntry[]
}

/** キープした言葉を、通話のあとで見返せるようにファイルに残す。フォルダで分けられる */
export class Wordbook {
  private folders: string[] = []
  private entries: WordbookEntry[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {
    try {
      if (!existsSync(file)) return
      const data = JSON.parse(readFileSync(file, 'utf8')) as WordbookData | WordbookEntry[]
      // 初めのころの形式（言葉の配列だけ）も読めるようにする
      if (Array.isArray(data)) {
        this.entries = data
      } else {
        this.folders = data.folders ?? []
        this.entries = data.entries ?? []
      }
    } catch {
      // 壊れたファイルは空として扱う
    }
  }

  list(): WordbookData {
    return {
      folders: [...this.folders],
      entries: [...this.entries].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    }
  }

  /** 同じ言葉は1件にまとめ、新しい意味と会話で上書きする（入っているフォルダはそのまま） */
  async save(entry: WordbookEntry): Promise<void> {
    const i = this.entries.findIndex((e) => e.word === entry.word)
    if (i >= 0) this.entries[i] = { ...this.entries[i], ...stripEmpty(entry) }
    else this.entries.push(entry)
    return this.flush()
  }

  async remove(words: string[]): Promise<void> {
    const drop = new Set(words)
    this.entries = this.entries.filter((e) => !drop.has(e.word))
    return this.flush()
  }

  /** 言葉をフォルダに移す。folder が null なら未分類に戻す */
  async move(words: string[], folder: string | null): Promise<void> {
    const name = folder === null ? null : this.addFolder(folder)
    const target = new Set(words)
    for (const e of this.entries) {
      if (!target.has(e.word)) continue
      if (name === null) delete e.folder
      else e.folder = name
    }
    return this.flush()
  }

  async createFolder(name: string): Promise<void> {
    this.addFolder(name)
    return this.flush()
  }

  async renameFolder(from: string, to: string): Promise<void> {
    const name = cleanName(to)
    if (!name || from === name) return
    if (this.folders.includes(name)) throw new Error(`「${name}」というフォルダはもうあります`)
    this.folders = this.folders.map((f) => (f === from ? name : f))
    for (const e of this.entries) if (e.folder === from) e.folder = name
    return this.flush()
  }

  /** フォルダを消す。中の言葉は消さずに未分類に戻す */
  async deleteFolder(name: string): Promise<void> {
    this.folders = this.folders.filter((f) => f !== name)
    for (const e of this.entries) if (e.folder === name) delete e.folder
    return this.flush()
  }

  /** フォルダを作り（すでにあればそのまま）、長さなどを整えた名前を返す */
  private addFolder(name: string): string {
    const n = cleanName(name)
    if (!n) throw new Error('フォルダの名前を入れてください')
    if (!this.folders.includes(n)) this.folders.push(n)
    return n
  }

  private flush(): Promise<void> {
    // 書き込みが重ならないよう順番に行う
    const data = JSON.stringify({ folders: this.folders, entries: this.entries }, null, 2)
    // 前の書き込みが失敗していても（ファイルのロックなど）、今回の分は書く
    const write = this.writing.catch(() => {}).then(() => writeFile(this.file, data))
    this.writing = write
    return write
  }
}

function cleanName(name: string): string {
  return name.trim().slice(0, 40)
}

function stripEmpty(e: WordbookEntry): Partial<WordbookEntry> {
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && v !== '')) as Partial<WordbookEntry>
}
