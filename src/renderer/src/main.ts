import { CallCapture, type Speaker } from './audio/capture'
import { hasWebGPU, LocalWhisperTranscriber, whisperPresets } from './asr/local-whisper'
import { TranscriptionQueue, type TranscriptLine } from './asr/queue'
import { ReazonSpeechTranscriber } from './asr/reazonspeech'
import type { Transcriber } from './asr/transcriber'
import { WordBoard, type BoardWord } from './words/board'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const engineSelect = $<HTMLSelectElement>('engine')
const toggle = $<HTMLButtonElement>('toggle')
const status = $<HTMLParagraphElement>('status')
const transcript = $<HTMLOListElement>('transcript')
const stats = $<HTMLElement>('stats')
const keptEl = $<HTMLDivElement>('kept')
const wordsEl = $<HTMLDivElement>('words')
const meters: Record<Speaker, HTMLMeterElement> = {
  other: $('level-other'),
  self: $('level-self')
}

const SPEAKER_LABEL: Record<Speaker, string> = { other: '相手', self: '自分' }
const ENGINE_KEY = 'engine'

let engine: Transcriber | null = null
let capture: CallCapture | null = null
let queue: TranscriptionQueue | null = null
let running = false
const history: TranscriptLine[] = []
const board = new WordBoard()
/** ショートカットで選べるのは、言葉の一覧の上から9個まで */
const HOTKEY_SLOTS = 9

interface EngineOption {
  id: string
  label: string
  create(): Promise<Transcriber>
}

const engines: EngineOption[] = [
  {
    id: 'reazon',
    label: 'ReazonSpeech（日本語専用・おすすめ）',
    create: async () => new ReazonSpeechTranscriber()
  },
  ...whisperPresets.map((p) => ({
    id: p.id,
    label: p.label,
    create: async () => new LocalWhisperTranscriber(p, (await hasWebGPU()) ? 'webgpu' : 'wasm')
  }))
]

for (const e of engines) engineSelect.add(new Option(e.label, e.id))
try {
  const saved = localStorage.getItem(ENGINE_KEY)
  if (saved && engines.some((e) => e.id === saved)) engineSelect.value = saved
} catch {
  // 保存できない環境でも既定値で動く
}

toggle.addEventListener('click', () => (running ? stop() : start()))

// 会話ログを開いたときは最新の行を見せる
$<HTMLDetailsElement>('log').addEventListener('toggle', () => (transcript.scrollTop = transcript.scrollHeight))

window.hotkeys.onKeep((n) => {
  const w = board.recent()[n - 1]
  if (w) {
    board.keep(w.text, Date.now())
    renderBoard()
  }
})

async function start(): Promise<void> {
  running = true
  toggle.textContent = '停止'
  engineSelect.disabled = true
  history.length = 0
  transcript.replaceChildren()
  board.clear()
  renderBoard()
  renderStats()

  try {
    const choice = engines.find((e) => e.id === engineSelect.value)!
    try {
      localStorage.setItem(ENGINE_KEY, choice.id)
    } catch {
      // 無視
    }
    // 先に音声の取り込みを始めて、モデルの準備中もメーターで音が入っているか確かめられるようにする
    capture = new CallCapture({
      onLevel: (speaker, level) => (meters[speaker].value = level),
      onSegment: (speaker, seg, capturedAt) => {
        // モデルの準備が終わるまでの発話は捨てる
        queue?.push(speaker, seg.audio, capturedAt)
        renderStats()
      }
    })
    await capture.start()

    engine = await choice.create()
    status.textContent = `${engine.label} を準備しています…（初回はダウンロードに時間がかかります）`
    try {
      await engine.load((p) => {
        status.textContent = p.percent == null ? p.message : `${p.message} ${p.percent.toFixed(0)}%`
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(msg === 'Failed to fetch' ? 'モデルをダウンロードできませんでした。ネット接続を確認してください' : msg)
    }
    if (!running) return

    queue = new TranscriptionQueue(engine, addLine, (err) => {
      status.textContent = `文字起こしエラー: ${err.message}`
    })
    status.textContent = `${engine.label} で聞き取り中`
  } catch (err) {
    status.textContent = `開始できませんでした: ${err instanceof Error ? err.message : String(err)}`
    stop(false)
  }
}

function stop(resetStatus = true): void {
  running = false
  capture?.stop()
  capture = null
  engine?.dispose()
  engine = null
  queue = null
  toggle.textContent = '開始'
  engineSelect.disabled = false
  meters.other.value = 0
  meters.self.value = 0
  if (resetStatus) status.textContent = '停止しました。'
}

function addLine(line: TranscriptLine): void {
  history.push(line)
  const li = document.createElement('li')
  li.className = line.speaker
  const who = document.createElement('span')
  who.className = 'who'
  who.textContent = SPEAKER_LABEL[line.speaker]
  const body = document.createElement('span')
  body.textContent = line.text
  const timing = document.createElement('span')
  timing.className = 'timing'
  timing.textContent = `遅れ ${sec(line.latencyMs)} ・ 処理 ${sec(line.inferenceMs)}（音声 ${sec(line.audioMs)}）`
  li.append(who, body, timing)
  transcript.append(li)
  transcript.scrollTop = transcript.scrollHeight
  renderStats()

  window.terms
    .extract(line.text)
    .then((terms) => {
      if (terms.length === 0) return
      board.add(terms, line.speaker, Date.now())
      highlight(body, line.text, terms.map((t) => t.text))
      renderBoard()
    })
    .catch((err) => console.error('言葉の抜き出しに失敗しました', err))
}

/** 会話ログの中で、抜き出した言葉に印を付ける */
function highlight(el: HTMLElement, text: string, words: string[]): void {
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`)
  el.replaceChildren(
    ...text.split(pattern).map((part, i) => {
      if (i % 2 === 0) return document.createTextNode(part)
      const mark = document.createElement('mark')
      mark.textContent = part
      return mark
    })
  )
}

function renderBoard(): void {
  keptEl.replaceChildren(...board.kept().map((w) => chip(w, null, () => board.unkeep(w.text))))
  wordsEl.replaceChildren(
    ...board.recent().map((w, i) =>
      chip(w, i < HOTKEY_SLOTS ? i + 1 : null, () => board.keep(w.text, Date.now()))
    )
  )
}

function chip(w: BoardWord, num: number | null, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = `chip ${w.speaker}`
  b.title = `${SPEAKER_LABEL[w.speaker]}が言った言葉${w.count > 1 ? `（${w.count}回）` : ''}`
  if (num !== null) {
    const n = document.createElement('span')
    n.className = 'num'
    n.textContent = String(num)
    b.append(n)
  }
  b.append(w.text)
  if (w.reading) {
    const r = document.createElement('span')
    r.className = 'reading'
    r.textContent = w.reading
    b.append(r)
  }
  b.addEventListener('click', () => {
    onClick()
    renderBoard()
  })
  return b
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderStats(): void {
  if (history.length === 0) {
    stats.textContent = queue ? `待ち ${queue.backlog} 件` : ''
    return
  }
  const avg = (f: (l: TranscriptLine) => number) => history.reduce((s, l) => s + f(l), 0) / history.length
  const speed = history.reduce((s, l) => s + l.inferenceMs, 0) / history.reduce((s, l) => s + l.audioMs, 0)
  stats.textContent =
    `平均の遅れ ${sec(avg((l) => l.latencyMs))} ・ ` +
    `処理速度 ${speed.toFixed(2)}倍（1未満なら追いつける） ・ 待ち ${queue?.backlog ?? 0} 件`
}

function sec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}秒`
}
