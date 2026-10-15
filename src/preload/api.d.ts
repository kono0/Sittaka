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
      extract(text: string): Promise<{ text: string; reading?: string; reasons: string[] }[]>
    }
    /** 全体ショートカット（Ctrl+Alt+数字） */
    hotkeys: {
      onKeep(handler: (n: number) => void): void
    }
  }
}

export {}
