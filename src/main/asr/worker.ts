// utilityProcess で動く文字起こし担当。重い計算で main プロセスや画面を止めないよう分けている。
import { join } from 'node:path'
import { OfflineRecognizer } from 'sherpa-onnx-node'
import type { AsrRequest, AsrResponse } from './protocol'
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
      post({ type: 'result', id: req.id, text: recognizer.getResult(stream).text.trim() })
    }
  } catch (err) {
    post({
      type: 'error',
      id: req.type === 'transcribe' ? req.id : undefined,
      message: err instanceof Error ? err.message : String(err)
    })
  }
})
