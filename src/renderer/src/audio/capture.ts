import workletUrl from './frame-collector.worklet.js?url'
import { rms, Segmenter, type Segment } from './segmenter'

export type Speaker = 'other' | 'self'

export interface CaptureEvents {
  onLevel(speaker: Speaker, level: number): void
  onSegment(speaker: Speaker, segment: Segment, capturedAt: number): void
  /** 自分の声に使うマイク。'default' は Windows の既定、'off' は取り込まない、それ以外は deviceId */
  micDevice(): string
  /** イヤホンなどをつなぎ替えたので、取り込み直した（失敗したときは error 付き） */
  onReconnect?(error?: string): void
}

interface Source {
  speaker: Speaker
  stream: MediaStream
  input: MediaStreamAudioSourceNode
  node: AudioWorkletNode
}

const SAMPLE_RATE = 16000
/** 機器のつなぎ替えでイベントが続けて来るので、落ち着くまで待ってから取り込み直す */
const RECONNECT_DELAY_MS = 1000

/**
 * 相手の声（PCの再生音）と自分の声（マイク）を別々に取り込み、
 * それぞれ発話単位に区切って渡す。
 */
export class CallCapture {
  private ctx: AudioContext | null = null
  private sources: Source[] = []
  private segmenters = new Map<Speaker, Segmenter>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnecting = false
  private readonly onDeviceChange = () => this.scheduleReconnect()

  constructor(private readonly events: CaptureEvents) {}

  async start(): Promise<void> {
    this.ctx = createContext()
    await this.ctx.audioWorklet.addModule(workletUrl)
    await this.openSources()
    // イヤホンやオーディオ機器をつなぐと、Windows の既定の機器が切り替わって
    // それまでの取り込みが止まったり無音になったりするので、つなぎ直す
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange)
  }

  stop(): void {
    navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.closeSources()
    this.segmenters.clear()
    this.ctx?.close()
    this.ctx = null
  }

  private async openSources(): Promise<void> {
    // 相手の声: main プロセスがループバック音声を返すようにしてある
    const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    display.getVideoTracks().forEach((t) => t.stop())
    if (display.getAudioTracks().length === 0) {
      throw new Error('PCの再生音を取り込めませんでした')
    }
    this.attach('other', new MediaStream(display.getAudioTracks()))

    // 自分の声: スピーカーから漏れた相手の声を拾いにくくするためエコー除去を有効にする
    const device = this.events.micDevice()
    if (device === 'off') return
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    let mic: MediaStream
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: device === 'default' ? audio : { ...audio, deviceId: { exact: device } }
      })
    } catch (err) {
      // 選んだマイクが外されているときは既定のマイクを使う
      if (device === 'default') throw err
      mic = await navigator.mediaDevices.getUserMedia({ audio })
    }
    this.attach('self', mic)
  }

  /** マイクの設定を変えたときなどに、取り込み直す */
  refresh(): void {
    this.scheduleReconnect()
  }

  /** 取り込みを止める。話している途中の分は文字起こしに回す */
  private closeSources(): void {
    for (const s of this.sources) {
      const last = this.segmenters.get(s.speaker)?.end()
      if (last) this.events.onSegment(s.speaker, last, performance.now())
      s.node.port.onmessage = null
      s.input.disconnect()
      s.node.disconnect()
      s.stream.getTracks().forEach((t) => {
        t.onended = null
        t.stop()
      })
    }
    this.sources = []
  }

  private scheduleReconnect(): void {
    if (!this.ctx) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => void this.reconnect(), RECONNECT_DELAY_MS)
  }

  private async reconnect(): Promise<void> {
    this.reconnectTimer = null
    if (!this.ctx || this.reconnecting) return
    this.reconnecting = true
    try {
      this.closeSources()
      await this.openSources()
      this.events.onReconnect?.()
    } catch (err) {
      this.events.onReconnect?.(err instanceof Error ? err.message : String(err))
    } finally {
      this.reconnecting = false
    }
  }

  private attach(speaker: Speaker, stream: MediaStream): void {
    const ctx = this.ctx
    if (!ctx) {
      // 機器の許可を待っている間に「停止」されたときは、遅れて届いた取り込みをすぐ止める
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    const src = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'frame-collector')
    // つなぎ直しても、それまでの背景ノイズの推定は引き継ぐ
    let segmenter = this.segmenters.get(speaker)
    if (!segmenter) {
      segmenter = new Segmenter({ sampleRate: SAMPLE_RATE })
      this.segmenters.set(speaker, segmenter)
    }
    // 機器を外したときなど、取り込みが止まったらつなぎ直す
    stream.getAudioTracks().forEach((t) => (t.onended = () => this.scheduleReconnect()))

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
    this.sources.push({ speaker, stream, input: src, node })
  }
}

/**
 * 出力先を「なし」にした AudioContext を作る。スピーカーやイヤホンにつながっていると、
 * 機器を切り替えたときに処理が止まったり途切れたりするため。使えない環境では普通に作る。
 */
function createContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: SAMPLE_RATE, sinkId: { type: 'none' } } as AudioContextOptions)
  } catch {
    return new AudioContext({ sampleRate: SAMPLE_RATE })
  }
}
