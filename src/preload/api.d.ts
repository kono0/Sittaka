import type { Transcript } from '../main/asr/protocol'
export type { AsrToken, Transcript } from '../main/asr/protocol'

export interface WordbookEntry {
  word: string
  reading?: string
  meaning?: string
  context: string
  savedAt: string
  folder?: string
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
      /** 使ったモデルの名前（古い記録にはない） */
      model?: string
    }
  | { status: 'error'; error: string; prompt: string; raw: string; ms: number; model?: string }

export type ProviderId = 'sarashina' | 'gemini' | 'claude'

declare global {
  interface Window {
    appInfo: { platform: string }
    /** main プロセス側で動く ReazonSpeech */
    asr: {
      load(onProgress: (p: { percent: number | null; message: string }) => void): Promise<void>
      transcribe(samples: Float32Array): Promise<Transcript>
      stop(): Promise<void>
    }
    /** 発話から調べる候補の言葉を抜き出す */
    terms: {
      extract(text: string): Promise<Extracted>
    }
    settings: {
      /** 使う AI と、会社ごとのキーの有無（キーそのものは画面に渡さない） */
      get(): Promise<{ provider: ProviderId; keys: Record<ProviderId, boolean> }>
      setProvider(provider: ProviderId): Promise<void>
      setKey(provider: ProviderId, key: string | null): Promise<void>
    }
    /** AI による絞り込みと意味の説明。キーがなければ使えない */
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
      list(): Promise<{ folders: string[]; entries: WordbookEntry[] }>
      save(entry: WordbookEntry): Promise<void>
      remove(words: string[]): Promise<void>
      /** folder が null なら未分類に戻す */
      move(words: string[], folder: string | null): Promise<void>
      createFolder(name: string): Promise<void>
      renameFolder(from: string, to: string): Promise<void>
      /** 中の言葉は消さずに未分類に戻す */
      deleteFolder(name: string): Promise<void>
    }
    panel: {
      /** パネルの幅を広げる（検証タブ用） */
      setWide(wide: boolean): Promise<void>
      /** 縦長のパネル（full）と、画面の端の小さな帯（mini）を切り替える */
      setMode(mode: 'full' | 'mini'): Promise<void>
    }
    /** 全体ショートカット（Ctrl+Alt+数字・Ctrl+Alt+M） */
    hotkeys: {
      onKeep(handler: (n: number) => void): void
      onToggleMode(handler: () => void): void
    }
  }
}

export {}
