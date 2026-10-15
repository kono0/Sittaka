import type { LoadProgress, Transcriber } from './transcriber'

/**
 * 日本語専用の ReazonSpeech。CPU だけで会話より十分速く動く。
 * 音声は PC の外に送らない（実体は main プロセス側の別プロセスで動く）。
 */
export class ReazonSpeechTranscriber implements Transcriber {
  readonly label = 'ReazonSpeech'

  load(onProgress: (p: LoadProgress) => void): Promise<void> {
    return window.asr.load(onProgress)
  }

  transcribe(audio: Float32Array): Promise<string> {
    return window.asr.transcribe(audio)
  }

  dispose(): void {
    void window.asr.stop()
  }
}
