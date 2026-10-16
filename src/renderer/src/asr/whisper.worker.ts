// Web Worker の中で Whisper を動かす（画面が固まらないように）。
import { pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from '@huggingface/transformers'

export type WorkerRequest =
  | { type: 'load'; model: string; device: 'webgpu' | 'wasm'; dtype: string }
  | { type: 'transcribe'; id: number; audio: Float32Array }

export type WorkerResponse =
  | { type: 'progress'; file: string; percent: number | null; status: string }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string }

let asr: AutomaticSpeechRecognitionPipeline | null = null

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  try {
    if (req.type === 'load') {
      asr = (await pipeline('automatic-speech-recognition', req.model, {
        device: req.device,
        dtype: req.dtype as never,
        progress_callback: (p: ProgressInfo) => {
          if (p.status === 'progress') {
            post({ type: 'progress', file: p.file, percent: p.progress ?? null, status: p.status })
          } else if ('file' in p) {
            post({ type: 'progress', file: p.file, percent: null, status: p.status })
          }
        }
      })) as AutomaticSpeechRecognitionPipeline
      // 最初の推論は遅いので、空の音声で一度温めておく
      await asr(new Float32Array(16000), { language: 'japanese', task: 'transcribe' })
      post({ type: 'ready' })
    } else if (req.type === 'transcribe') {
      if (!asr) throw new Error('モデルが読み込まれていません')
      const out = await asr(req.audio, { language: 'japanese', task: 'transcribe' })
      const text = Array.isArray(out) ? out.map((o) => o.text).join('') : out.text
      post({ type: 'result', id: req.id, text: text.trim() })
    }
  } catch (err) {
    post({
      type: 'error',
      id: req.type === 'transcribe' ? req.id : undefined,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
