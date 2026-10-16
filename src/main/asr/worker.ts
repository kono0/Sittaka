// utilityProcess で動く文字起こし担当。重い計算で main プロセスや画面を止めないよう分けている。
import { join } from 'node:path'
import { OfflineRecognizer } from 'sherpa-onnx-node'
import type { AsrRequest, AsrResponse, Transcript } from './protocol'
import { MODEL_FILES } from './model-files'

let recognizer: OfflineRecognizer | null = null

const post = (msg: AsrResponse) => process.parentPort.postMessage(msg)

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const req = e.data as AsrRequest
  try {
    if (req.type === 'load') {
      const f = (name: string) => join(req.modelDir, name)
      recognizer = new OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: f(MODEL_FILES.encoder),
            decoder: f(MODEL_FILES.decoder),
            joiner: f(MODEL_FILES.joiner)
          },
          tokens: f(MODEL_FILES.tokens),
          numThreads: req.numThreads,
          provider: 'cpu',
          debug: 0
        },
        decodingMethod: 'greedy_search'
      })
      post({ type: 'ready' })
    } else if (req.type === 'transcribe') {
      if (!recognizer) throw new Error('モデルが読み込まれていません')
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples: req.samples, sampleRate: 16000 })
      recognizer.decode(stream)
      post({ type: 'result', id: req.id, transcript: toTranscript(recognizer.getResult(stream)) })
    }
  } catch (err) {
    post({
      type: 'error',
      id: req.type === 'transcribe' ? req.id : undefined,
      message: err instanceof Error ? err.message : String(err)
    })
  }
})

/** 文字ごとの確率（対数）を 0〜1 にして付ける。空白だけの文字は落とす */
function toTranscript(r: { text: string; tokens?: string[]; ys_log_probs?: number[] }): Transcript {
  const text = r.text.trim()
  const probs = r.ys_log_probs
  if (!r.tokens || !probs || probs.length !== r.tokens.length) return { text }
  const tokens = r.tokens
    .map((t, i) => ({ text: t, p: Math.round(Math.exp(probs[i]) * 100) / 100 }))
    .filter((t) => t.text.trim())
  return { text, tokens }
}
