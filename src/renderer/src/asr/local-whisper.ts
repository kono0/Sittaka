import type { LoadProgress, Transcriber, Transcript } from './transcriber'
import type { WorkerRequest, WorkerResponse } from './whisper.worker'

export interface WhisperPreset {
  id: string
  label: string
  model: string
  dtype: string
}

// 軽い順。どれが内蔵グラフィックでも間に合うかを実機で比べるための候補。
export const whisperPresets: WhisperPreset[] = [
  { id: 'base', label: 'Whisper base（軽い・約80MB）', model: 'onnx-community/whisper-base', dtype: 'q8' },
  { id: 'small', label: 'Whisper small（中くらい・約250MB）', model: 'onnx-community/whisper-small', dtype: 'q8' },
  {
    id: 'turbo',
    label: 'Whisper large-v3-turbo（高精度・重い）',
    model: 'onnx-community/whisper-large-v3-turbo',
    dtype: 'q4'
  }
]

export async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) != null
  } catch {
    return false
  }
}

/** PCの中で Whisper を動かすエンジン。音声は外に送らない。 */
export class LocalWhisperTranscriber implements Transcriber {
  readonly label: string
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, { resolve(t: string): void; reject(e: Error): void }>()

  constructor(
    private readonly preset: WhisperPreset,
    private readonly device: 'webgpu' | 'wasm'
  ) {
    this.label = `${preset.label} / ${device === 'webgpu' ? 'GPU' : 'CPU'}`
  }

  load(onProgress: (p: LoadProgress) => void): Promise<void> {
    this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
    return new Promise((resolve, reject) => {
      this.worker!.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data
        switch (msg.type) {
          case 'progress':
            onProgress({
              percent: msg.percent,
              message: msg.status === 'progress' ? `ダウンロード中 ${msg.file}` : `${msg.status} ${msg.file}`
            })
            break
          case 'ready':
            resolve()
            break
          case 'result':
            this.pending.get(msg.id)?.resolve(msg.text)
            this.pending.delete(msg.id)
            break
          case 'error':
            if (msg.id === undefined) {
              reject(new Error(msg.message))
            } else {
              this.pending.get(msg.id)?.reject(new Error(msg.message))
              this.pending.delete(msg.id)
            }
        }
      }
      this.send({ type: 'load', model: this.preset.model, device: this.device, dtype: this.preset.dtype })
    })
  }

  async transcribe(audio: Float32Array): Promise<Transcript> {
    const id = this.nextId++
    const text = await new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ type: 'transcribe', id, audio }, [audio.buffer])
    })
    return { text }
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const p of this.pending.values()) p.reject(new Error('停止しました'))
    this.pending.clear()
  }

  private send(req: WorkerRequest, transfer: Transferable[] = []): void {
    if (!this.worker) throw new Error('エンジンが起動していません')
    this.worker.postMessage(req, transfer)
  }
}
