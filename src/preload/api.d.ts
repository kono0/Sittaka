export interface WordbookEntry {
  word: string
  reading?: string
  meaning?: string
  context: string
  savedAt: string
}

// main プロセス側（src/main/terms/ipc.ts・src/main/ai/ipc.ts）と同じ形
export interface Extracted {
  /** 規則で選んだ言葉 */
  terms: { text: string; reading?: string; reasons: string[] }[]
  /** ふるいにかける前の名詞のまとまりすべて（AI に渡す候補） */
  nouns: string[]
  /** 形態素解析の結果 */
  tokens: { surface: string; pos: string; known: boolean }[]
}

export type RefineResult =
  | { status: 'no-key' }
  | { status: 'busy'; waitMs: number }
  | {
      status: 'ok'
      terms: { text: string; reading: string }[]
      /** 候補1つずつの AI の採点（1〜4） */
      judgments: { candidate: string; text: string; level: number; added: boolean; kept: boolean }[]
      prompt: string
      raw: string
      ms: number
    }
  | { status: 'error'; error: string; prompt: string; raw: string; ms: number }

declare global {
  interface Window {
    appInfo: { platform: string }
    /** main プロセス側で動く ReazonSpeech */
    asr: {
      load(onProgress: (p: { percent: number | null; message: string }) => void): Promise<void>
      transcribe(samples: Float32Array): Promise<string>
      stop(): Promise<void>
    }
    /** 発話から調べる候補の言葉を抜き出す */
    terms: {
      extract(text: string): Promise<Extracted>
    }
    settings: {
      get(): Promise<{ hasSarashinaKey: boolean }>
      setSarashinaKey(key: string | null): Promise<void>
    }
    /** Sarashina による絞り込みと意味の説明。キーがなければ使えない */
    ai: {
      /** キーがない・混んでいるときは AI を通さない（規則の結果を使う） */
      refine(
        context: string[],
        utterance: string,
        candidates: string[],
        amount: 'few' | 'normal' | 'many'
      ): Promise<RefineResult>
      explain(
        context: string[],
        word: string
      ): Promise<{ ok: true; value: { word: string; reading: string; meaning: string } } | { ok: false; error: string }>
    }
    wordbook: {
      list(): Promise<WordbookEntry[]>
      save(entry: WordbookEntry): Promise<void>
      remove(word: string): Promise<void>
    }
    /** パネルの幅を広げる（検証タブ用） */
    panel: {
      setWide(wide: boolean): Promise<void>
    }
    /** 全体ショートカット（Ctrl+Alt+数字） */
    hotkeys: {
      onKeep(handler: (n: number) => void): void
    }
  }
}

export {}
