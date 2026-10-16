// 文字起こしエンジンの共通の形。ローカルの Whisper もクラウドの API も
// これを実装すれば、画面側を変えずに差し替えられる。

import type { Transcript } from '../../../preload/api'

export type { Transcript }

export interface LoadProgress {
  /** 0〜100。分からないときは null */
  percent: number | null
  message: string
}

export interface Transcriber {
  readonly label: string
  load(onProgress: (p: LoadProgress) => void): Promise<void>
  /** 16kHz モノラルの音声を日本語の文字にする */
  transcribe(audio: Float32Array): Promise<Transcript>
  dispose(): void
}
