export interface WordbookEntry {
  word: string
  reading?: string
  meaning?: string
  context: string
  savedAt: string
}

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
      /** terms: 規則で選んだ言葉 / nouns: ふるいにかける前の名詞すべて（AI に渡す） */
      extract(
        text: string
      ): Promise<{ terms: { text: string; reading?: string; reasons: string[] }[]; nouns: string[] }>
    }
    settings: {
      get(): Promise<{ hasSarashinaKey: boolean }>
      setSarashinaKey(key: string | null): Promise<void>
    }
    /** Sarashina による絞り込みと意味の説明。キーがなければ使えない */
    ai: {
      /** キーがない・混んでいるときは null（規則の結果をそのまま使う） */
      refine(
        context: string[],
        utterance: string,
        candidates: string[],
        amount: 'few' | 'normal' | 'many'
      ): Promise<{ ok: true; value: { text: string; reading: string }[] } | { ok: false; error: string } | null>
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
    /** 全体ショートカット（Ctrl+Alt+数字） */
    hotkeys: {
      onKeep(handler: (n: number) => void): void
    }
  }
}

export {}
