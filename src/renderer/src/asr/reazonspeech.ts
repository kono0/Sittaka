import type { LoadProgress, Transcriber, Transcript } from './transcriber'

/**
 * 日本語専用の ReazonSpeech。CPU だけで会話より十分速く動く。
 * 音声は PC の外に送らない（実体は main プロセス側の別プロセスで動く）。
 */
export class ReazonSpeechTranscriber implements Transcriber {
  readonly label = 'ReazonSpeech'

  /** hints: 出やすくしたい言葉（認識のヒント）。null ならヒントを使わない */
  constructor(private readonly hints: (() => string[]) | null = null) {}

  load(onProgress: (p: LoadProgress) => void): Promise<void> {
    return window.asr.load(onProgress, this.hints !== null)
  }

  transcribe(audio: Float32Array): Promise<Transcript> {
    return window.asr.transcribe(audio, this.hints?.())
  }

  dispose(): void {
    void window.asr.stop()
  }
}
