import workletUrl from './frame-collector.worklet.js?url'
import { rms, Segmenter, type Segment } from './segmenter'

export type Speaker = 'other' | 'self'

export interface CaptureEvents {
  onLevel(speaker: Speaker, level: number): void
  onSegment(speaker: Speaker, segment: Segment, capturedAt: number): void
}

interface Source {
  stream: MediaStream
  node: AudioWorkletNode
}

const SAMPLE_RATE = 16000

/**
 * 相手の声（PCの再生音）と自分の声（マイク）を別々に取り込み、
 * それぞれ発話単位に区切って渡す。
 */
export class CallCapture {
  private ctx: AudioContext | null = null
  private sources: Source[] = []
  private segmenters = new Map<Speaker, Segmenter>()

  constructor(private readonly events: CaptureEvents) {}

  async start(): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    await this.ctx.audioWorklet.addModule(workletUrl)

    // 相手の声: main プロセスがループバック音声を返すようにしてある
    const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    display.getVideoTracks().forEach((t) => t.stop())
    if (display.getAudioTracks().length === 0) {
      throw new Error('PCの再生音を取り込めませんでした')
    }
    this.attach('other', new MediaStream(display.getAudioTracks()))

    // 自分の声: スピーカーから漏れた相手の声を拾いにくくするためエコー除去を有効にする
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    this.attach('self', mic)
  }

  stop(): void {
    for (const [speaker, seg] of this.segmenters) {
      const last = seg.end()
      if (last) this.events.onSegment(speaker, last, performance.now())
    }
    for (const s of this.sources) {
      s.node.port.onmessage = null
      s.node.disconnect()
      s.stream.getTracks().forEach((t) => t.stop())
    }
    this.sources = []
    this.segmenters.clear()
    this.ctx?.close()
    this.ctx = null
  }

  private attach(speaker: Speaker, stream: MediaStream): void {
    const ctx = this.ctx!
    const src = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'frame-collector')
    const segmenter = new Segmenter({ sampleRate: SAMPLE_RATE })
    this.segmenters.set(speaker, segmenter)

    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const frame = e.data
      this.events.onLevel(speaker, rms(frame))
      for (const seg of segmenter.push(frame)) {
        this.events.onSegment(speaker, seg, performance.now())
      }
    }
    // 描画グラフにつながっていないと処理されないため、音量ゼロで出力先につなぐ
    // （ループバック音がスピーカーから二重に鳴るのを防ぐ）
    const mute = ctx.createGain()
    mute.gain.value = 0
    src.connect(node).connect(mute).connect(ctx.destination)
    this.sources.push({ stream, node })
  }
}
