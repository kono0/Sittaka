declare global {
  interface Window {
    appInfo: { platform: string }
    /** main プロセス側で動く ReazonSpeech */
    asr: {
      load(onProgress: (p: { percent: number | null; message: string }) => void): Promise<void>
      transcribe(samples: Float32Array): Promise<string>
      stop(): Promise<void>
    }
  }
}

export {}
