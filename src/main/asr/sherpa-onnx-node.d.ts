// sherpa-onnx-node は型定義を同梱していないので、使う分だけ宣言する
declare module 'sherpa-onnx-node' {
  export interface OfflineStream {
    acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void
  }
  export class OfflineRecognizer {
    constructor(config: unknown)
    createStream(hotwords?: string): OfflineStream
    decode(stream: OfflineStream): void
    getResult(stream: OfflineStream): { text: string; tokens?: string[]; ys_log_probs?: number[] }
  }
}
