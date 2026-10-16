import type { Speaker } from '../audio/capture'
import type { AsrToken } from '../../../preload/api'
import type { Transcriber } from './transcriber'

export interface TranscriptLine {
  speaker: Speaker
  text: string
  /** 発話が終わってから文字が出るまでの時間 */
  latencyMs: number
  /** 文字起こしそのものにかかった時間 */
  inferenceMs: number
  audioMs: number
  /** 文字ごとの確率（エンジンが出せるときだけ） */
  tokens?: AsrToken[]
  /** 認識のヒントとして渡した言葉の数（使っていないときはなし） */
  hints?: number
}

interface Job {
  speaker: Speaker
  audio: Float32Array
  capturedAt: number
}

/**
 * 発話を1件ずつ順番に文字起こしする。相手と自分の発話が同時に来ても
 * エンジンには1件ずつ渡す（ローカルのモデルは並列に回すと遅くなるため）。
 */
export class TranscriptionQueue {
  private jobs: Job[] = []
  private running = false

  constructor(
    private readonly engine: Transcriber,
    private readonly onLine: (line: TranscriptLine) => void,
    private readonly onError: (err: Error) => void,
    private readonly now: () => number = () => performance.now()
  ) {}

  get backlog(): number {
    return this.jobs.length
  }

  push(speaker: Speaker, audio: Float32Array, capturedAt: number): void {
    this.jobs.push({ speaker, audio, capturedAt })
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.jobs.length > 0) {
        const job = this.jobs.shift()!
        const audioMs = (job.audio.length / 16000) * 1000
        const started = this.now()
        try {
          const { text, tokens, hints } = await this.engine.transcribe(job.audio)
          const done = this.now()
          if (text) {
            this.onLine({
              speaker: job.speaker,
              text,
              latencyMs: done - job.capturedAt,
              inferenceMs: done - started,
              audioMs,
              ...(tokens ? { tokens } : {}),
              ...(hints !== undefined ? { hints } : {})
            })
          }
        } catch (err) {
          this.onError(err instanceof Error ? err : new Error(String(err)))
        }
      }
    } finally {
      this.running = false
    }
  }
}
