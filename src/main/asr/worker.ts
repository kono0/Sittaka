// utilityProcess で動く文字起こし担当。重い計算で main プロセスや画面を止めないよう分けている。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OfflineRecognizer } from 'sherpa-onnx-node'
import type { AsrRequest, AsrResponse, Transcript } from './protocol'
import { MODEL_FILES } from './model-files'

let recognizer: OfflineRecognizer | null = null
/** モデルが書ける文字。ヒントの言葉にこれ以外の文字があると、ヒント全体が無視されてしまう */
let vocab = new Set<string>()

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
        // ヒントは beam search でしか使えない（少し遅くなる）。強くしすぎると正しい部分まで
        // ヒントの言葉に引っぱられて崩れたので、試した中で崩れなかった 1.0 にしている
        decodingMethod: req.hints ? 'modified_beam_search' : 'greedy_search',
        hotwordsScore: 1.0
      })
      vocab = new Set(
        readFileSync(f(MODEL_FILES.tokens), 'utf8')
          .split('\n')
          .map((line) => line.split(/\s+/)[0])
          .filter(Boolean)
      )
      post({ type: 'ready' })
    } else if (req.type === 'transcribe') {
      if (!recognizer) throw new Error('モデルが読み込まれていません')
      const hints = req.hints ? toHotwords(req.hints) : null
      const stream = hints?.length ? recognizer.createStream(hints.join('/')) : recognizer.createStream()
      stream.acceptWaveform({ samples: req.samples, sampleRate: 16000 })
      recognizer.decode(stream)
      const transcript = toTranscript(recognizer.getResult(stream))
      if (hints) transcript.hints = hints.length
      post({ type: 'result', id: req.id, transcript })
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

/**
 * ヒントの言葉を sherpa-onnx の書式（1文字ずつ空白で区切り、言葉は / で区切る）にする。
 * モデルが書けない文字を含む言葉は落とす。
 */
function toHotwords(words: string[]): string[] {
  const out: string[] = []
  for (const w of words) {
    const chars = [...w.replace(/\s+/g, '')]
    if (chars.length >= 2 && chars.every((c) => vocab.has(c))) out.push(chars.join(' '))
  }
  return out
}
