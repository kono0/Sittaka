// 16kHz の音声フレームを受け取り、発話ごとの区間に切り分ける。
// 音量（RMS）が背景ノイズより十分大きい間を「話している」とみなす単純な VAD。
// 背景ノイズは直近の音量の下位10%として推定するので、空調音のような
// 鳴りっぱなしの音にも数秒で慣れる。

export interface SegmenterOptions {
  sampleRate: number
  /** これより小さい音量は常に無音とみなす */
  minThreshold: number
  /** 背景ノイズの何倍を超えたら発話とみなすか */
  noiseRatio: number
  /** この長さ無音が続いたら発話の終わりとする */
  endSilenceMs: number
  /** これより短い発話は捨てる（咳や物音） */
  minSpeechMs: number
  /** 長く話し続けてもこの長さで区切って先に文字起こしに回す */
  maxSegmentMs: number
  /** 発話開始の直前を少し含める */
  preRollMs: number
  /** 背景ノイズを推定するために振り返る長さ */
  noiseWindowMs: number
}

export interface Segment {
  audio: Float32Array
  /** セグメント終端の時刻（入力の先頭からのミリ秒） */
  endMs: number
  durationMs: number
}

export const defaultSegmenterOptions: SegmenterOptions = {
  sampleRate: 16000,
  minThreshold: 0.008,
  noiseRatio: 3,
  endSilenceMs: 500,
  minSpeechMs: 300,
  maxSegmentMs: 8000,
  preRollMs: 200,
  noiseWindowMs: 10000
}

export function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / Math.max(frame.length, 1))
}

export class Segmenter {
  private readonly opts: SegmenterOptions
  /** 直近のフレームの音量と長さ（背景ノイズ推定用） */
  private levels: { level: number; samples: number }[] = []
  private levelSamples = 0
  private preRoll: Float32Array[] = []
  private preRollSamples = 0
  private current: Float32Array[] = []
  private currentSamples = 0
  private voicedSamples = 0
  private silenceSamples = 0
  private totalSamples = 0
  private speaking = false

  constructor(options: Partial<SegmenterOptions> = {}) {
    this.opts = { ...defaultSegmenterOptions, ...options }
  }

  /** フレームを入れ、確定したセグメントがあれば返す */
  push(frame: Float32Array): Segment[] {
    const out: Segment[] = []
    this.totalSamples += frame.length
    const level = rms(frame)
    const threshold = Math.max(this.opts.minThreshold, this.estimateNoise(level, frame.length) * this.opts.noiseRatio)
    const voiced = level > threshold

    if (!this.speaking) {
      if (voiced) {
        this.speaking = true
        this.current = [...this.preRoll]
        this.currentSamples = this.preRollSamples
        this.voicedSamples = 0
        this.silenceSamples = 0
        this.preRoll = []
        this.preRollSamples = 0
      } else {
        this.keepPreRoll(frame)
        return out
      }
    }

    this.current.push(frame)
    this.currentSamples += frame.length
    if (voiced) {
      this.voicedSamples += frame.length
      this.silenceSamples = 0
    } else {
      this.silenceSamples += frame.length
    }

    if (this.ms(this.silenceSamples) >= this.opts.endSilenceMs) {
      const seg = this.flush()
      if (seg) out.push(seg)
    } else if (this.ms(this.currentSamples) >= this.opts.maxSegmentMs) {
      const seg = this.flush()
      if (seg) out.push(seg)
      // 話し続けている途中なので、発話状態を保ったまま次の区間を始める
      this.speaking = true
    }
    return out
  }

  /** 残っている発話を強制的に確定する（停止時） */
  end(): Segment | null {
    return this.speaking ? this.flush() : null
  }

  private flush(): Segment | null {
    const voicedMs = this.ms(this.voicedSamples)
    const audio = concat(this.current, this.currentSamples)
    this.speaking = false
    this.current = []
    this.currentSamples = 0
    this.voicedSamples = 0
    this.silenceSamples = 0
    if (voicedMs < this.opts.minSpeechMs) return null
    return { audio, endMs: this.ms(this.totalSamples), durationMs: this.ms(audio.length) }
  }

  private estimateNoise(level: number, samples: number): number {
    this.levels.push({ level, samples })
    this.levelSamples += samples
    const max = (this.opts.noiseWindowMs / 1000) * this.opts.sampleRate
    while (this.levels.length > 1 && this.levelSamples - this.levels[0].samples >= max) {
      this.levelSamples -= this.levels.shift()!.samples
    }
    // 振り返りが短いうちは推定しない（起動直後に話し始めても拾えるように）
    if (this.levelSamples < max / 4) return 0
    const sorted = this.levels.map((l) => l.level).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length * 0.1)]
  }

  private keepPreRoll(frame: Float32Array): void {
    this.preRoll.push(frame)
    this.preRollSamples += frame.length
    const max = (this.opts.preRollMs / 1000) * this.opts.sampleRate
    while (this.preRoll.length > 1 && this.preRollSamples - this.preRoll[0].length >= max) {
      this.preRollSamples -= this.preRoll.shift()!.length
    }
  }

  private ms(samples: number): number {
    return (samples / this.opts.sampleRate) * 1000
  }
}

function concat(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
