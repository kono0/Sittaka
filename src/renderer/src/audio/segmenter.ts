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
  /** これより長くなったら、息継ぎ程度の短い無音（softEndSilenceMs）でも発話の終わりとする */
  softMaxSegmentMs: number
  softEndSilenceMs: number
  /**
   * 息継ぎなしで話し続けても、この長さで区切って先に文字起こしに回す。
   * 言葉の途中で割れないように、直近 splitSearchMs の中で一番静かな瞬間で切る
   */
  maxSegmentMs: number
  splitSearchMs: number
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
  softMaxSegmentMs: 6000,
  softEndSilenceMs: 200,
  maxSegmentMs: 15000,
  splitSearchMs: 3000,
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
  private preRoll: Frame[] = []
  private preRollSamples = 0
  private current: Frame[] = []
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

    const f: Frame = { audio: frame, level, voiced }
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
        this.keepPreRoll(f)
        return out
      }
    }

    this.current.push(f)
    this.currentSamples += frame.length
    if (voiced) {
      this.voicedSamples += frame.length
      this.silenceSamples = 0
    } else {
      this.silenceSamples += frame.length
    }

    const length = this.ms(this.currentSamples)
    const silence = this.ms(this.silenceSamples)
    if (
      silence >= this.opts.endSilenceMs ||
      (length >= this.opts.softMaxSegmentMs && silence >= this.opts.softEndSilenceMs)
    ) {
      const seg = this.flush()
      if (seg) out.push(seg)
    } else if (length >= this.opts.maxSegmentMs) {
      const seg = this.splitAtQuietest()
      if (seg) out.push(seg)
    }
    return out
  }

  /** 残っている発話を強制的に確定する（停止時） */
  end(): Segment | null {
    return this.speaking ? this.flush() : null
  }

  private flush(): Segment | null {
    const seg = this.toSegment(this.current, this.voicedSamples, this.totalSamples)
    this.speaking = false
    this.current = []
    this.currentSamples = 0
    this.voicedSamples = 0
    this.silenceSamples = 0
    return seg
  }

  /**
   * 話し続けている途中で区切る。直近の一番静かなフレームまでを確定し、
   * 残りは発話状態のまま次の区間の頭にする（言葉が2つの区間に割れないように）。
   */
  private splitAtQuietest(): Segment | null {
    const search = (this.opts.splitSearchMs / 1000) * this.opts.sampleRate
    let cut = this.current.length - 1
    let searched = 0
    for (let i = this.current.length - 1; i > 0 && searched < search; i--) {
      searched += this.current[i].audio.length
      if (this.current[i].level <= this.current[cut].level) cut = i
    }
    const head = this.current.slice(0, cut + 1)
    const rest = this.current.slice(cut + 1)
    const restSamples = rest.reduce((n, f) => n + f.audio.length, 0)
    const restVoiced = rest.reduce((n, f) => n + (f.voiced ? f.audio.length : 0), 0)
    const seg = this.toSegment(head, this.voicedSamples - restVoiced, this.totalSamples - restSamples)
    this.current = rest
    this.currentSamples = restSamples
    this.voicedSamples = restVoiced
    return seg
  }

  private toSegment(frames: Frame[], voicedSamples: number, endSamples: number): Segment | null {
    if (this.ms(voicedSamples) < this.opts.minSpeechMs) return null
    const audio = concat(frames.map((f) => f.audio))
    return { audio, endMs: this.ms(endSamples), durationMs: this.ms(audio.length) }
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

  private keepPreRoll(frame: Frame): void {
    this.preRoll.push(frame)
    this.preRollSamples += frame.audio.length
    const max = (this.opts.preRollMs / 1000) * this.opts.sampleRate
    while (this.preRoll.length > 1 && this.preRollSamples - this.preRoll[0].audio.length >= max) {
      this.preRollSamples -= this.preRoll.shift()!.audio.length
    }
  }

  private ms(samples: number): number {
    return (samples / this.opts.sampleRate) * 1000
  }
}

interface Frame {
  audio: Float32Array
  level: number
  voiced: boolean
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
