import { CallCapture, type Speaker } from './audio/capture'
import { hasWebGPU, LocalWhisperTranscriber, whisperPresets } from './asr/local-whisper'
import { TranscriptionQueue, type TranscriptLine } from './asr/queue'
import { ReazonSpeechTranscriber } from './asr/reazonspeech'
import type { Transcriber } from './asr/transcriber'
import { Inspector } from './inspect/view'
import { WordBoard, type BoardWord } from './words/board'
import { findTerms, type Amount } from './words/pipeline'

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
// 検証タブ。手入力の文は会話の流れとは別に、直前の会話だけを文脈にして試す
const inspector = new Inspector($('inspect'), (text) => findTerms(text, 'other', recentContext(), amount, 'manual'))
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
  if (w) keepWord(w.text)
})

// タブ（会話・単語帳・設定）の切り替え
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs button')]
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const t of tabs) t.classList.toggle('active', t === tab)
    for (const v of document.querySelectorAll<HTMLElement>('.view')) v.hidden = v.dataset.view !== tab.dataset.view
    if (tab.dataset.view === 'wordbook') void renderWordbook()
    if (tab.dataset.view === 'settings') void renderSettings()
    inspector.setVisible(tab.dataset.view === 'inspect')
  })
}

const amountSelect = $<HTMLSelectElement>('amount')
let amount: Amount = 'normal'
try {
  const saved = localStorage.getItem('amount')
  if (saved === 'few' || saved === 'normal' || saved === 'many') amount = saved
} catch {
  // 保存できない環境でも既定値で動く
}
amountSelect.value = amount
amountSelect.addEventListener('change', () => {
  amount = amountSelect.value as Amount
  try {
    localStorage.setItem('amount', amount)
  } catch {
    // 無視
  }
})

$<HTMLFormElement>('key-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = $<HTMLInputElement>('key-input')
  if (!input.value.trim()) return
  try {
    await window.settings.setSarashinaKey(input.value)
    input.value = ''
    await renderSettings()
  } catch (err) {
    // IPC 越しのエラーは「Error invoking remote method ...: Error: 」が前に付くので外す
    const msg = (err instanceof Error ? err.message : String(err)).replace(/^.*Error: /, '')
    $<HTMLParagraphElement>('key-state').textContent = `保存できませんでした: ${msg}`
  }
})
$<HTMLButtonElement>('key-remove').addEventListener('click', async () => {
  await window.settings.setSarashinaKey(null)
  await renderSettings()
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
      },
      onReconnect: (error) => {
        status.textContent = error
          ? `音声機器が切り替わったあと、取り込み直せませんでした: ${error}（停止して開始し直してください）`
          : '音声機器が切り替わったので、取り込み直しました'
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
      throw new Error(
        msg === 'Failed to fetch' ? 'モデルをダウンロードできませんでした。ネット接続を確認してください' : msg
      )
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

  void findTermsForLine(line, body)
}

/** 直近の会話（AI に渡す文脈）。話し手を付けて最大4発話 */
function recentContext(): string[] {
  return history.slice(-4).map((l) => `${SPEAKER_LABEL[l.speaker]}: ${l.text}`)
}

async function findTermsForLine(line: TranscriptLine, body: HTMLElement): Promise<void> {
  const context = recentContext()
  const { trace, terms } = await findTerms(line.text, line.speaker, context.slice(0, -1), amount)
  trace.asr = { latencyMs: line.latencyMs, inferenceMs: line.inferenceMs, audioMs: line.audioMs }
  inspector.add(trace)
  if (trace.ai?.status === 'error') showAiError(trace.ai.error)
  if (trace.error) console.error('言葉の抜き出しに失敗しました', trace.error)
  if (terms.length === 0) return
  board.add(terms, line.speaker, Date.now(), context)
  // AI が漢字を直した言葉は元の文と一致しないので、印は付けられるものだけ
  const inText = terms.map((t) => t.text).filter((t) => line.text.includes(t))
  if (inText.length) highlight(body, line.text, inText)
  renderBoard()
}

/** AI のエラーは、同じものを何度も出さずに状態欄へ一度だけ出す */
let lastAiError = ''
function showAiError(error: string): void {
  if (error === lastAiError) return
  lastAiError = error
  status.textContent = `AI での絞り込みに失敗しました（${error}）。規則だけで選んでいます`
}

function keepWord(text: string): void {
  if (!board.keep(text, Date.now())) return
  const w = board.get(text)!
  w.meaning = { state: 'loading' }
  renderBoard()
  const context = w.context.join('\n')
  void window.wordbook.save({ word: text, reading: w.reading, context, savedAt: new Date().toISOString() })
  window.ai.explain(w.context, text).then((res) => {
    if (res.ok) {
      w.meaning = { state: 'done', ...res.value, text: res.value.meaning }
      void window.wordbook.save({
        word: text,
        reading: res.value.reading || w.reading,
        meaning: res.value.word !== text ? `（${res.value.word}）${res.value.meaning}` : res.value.meaning,
        context,
        savedAt: new Date().toISOString()
      })
    } else {
      w.meaning = { state: 'error', text: res.error }
    }
    renderBoard()
  })
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
  keptEl.replaceChildren(...board.kept().map(card))
  wordsEl.replaceChildren(
    ...board.recent().map((w, i) => chip(w, i < HOTKEY_SLOTS ? i + 1 : null, () => keepWord(w.text)))
  )
}

/** キープした言葉。意味が届いたら下に出す */
function card(w: BoardWord): HTMLElement {
  const el = document.createElement('div')
  el.className = 'card'
  const m = w.meaning
  const word = document.createElement('span')
  word.className = 'word'
  word.textContent = m?.state === 'done' ? m.word : w.text
  el.append(word)
  const reading = m?.state === 'done' && m.reading ? m.reading : w.reading
  if (reading) {
    const r = document.createElement('span')
    r.className = 'reading'
    r.textContent = reading
    el.append(r)
  }
  if (m) {
    const meaning = document.createElement('span')
    meaning.className = `meaning ${m.state === 'loading' ? 'pending' : m.state}`
    meaning.textContent = m.state === 'loading' ? '意味を調べています…' : m.text
    el.append(meaning)
  }
  const remove = document.createElement('button')
  remove.className = 'remove'
  remove.title = 'キープから外す（単語帳には残ります）'
  remove.textContent = '×'
  remove.addEventListener('click', () => {
    board.unkeep(w.text)
    renderBoard()
  })
  el.append(remove)
  return el
}

async function renderWordbook(): Promise<void> {
  const list = $<HTMLOListElement>('wordbook-list')
  const entries = await window.wordbook.list()
  list.replaceChildren(
    ...entries.map((e) => {
      const li = document.createElement('li')
      const word = document.createElement('strong')
      word.textContent = e.word
      li.append(word)
      if (e.reading) {
        const r = document.createElement('span')
        r.className = 'reading note'
        r.textContent = ` ${e.reading}`
        li.append(r)
      }
      const meaning = document.createElement('div')
      meaning.textContent = e.meaning ?? '（意味はまだありません）'
      const ctx = document.createElement('span')
      ctx.className = 'ctx'
      // 保存した会話のうち、その言葉が出てくる発言を見せる
      const lines = e.context.split('\n')
      const line = lines.find((l) => l.includes(e.word)) ?? lines[lines.length - 1] ?? ''
      ctx.textContent = `${new Date(e.savedAt).toLocaleString('ja-JP')} ・ ${line}`
      const remove = document.createElement('button')
      remove.className = 'remove'
      remove.title = '単語帳から削除'
      remove.textContent = '×'
      remove.addEventListener('click', async () => {
        await window.wordbook.remove(e.word)
        await renderWordbook()
      })
      li.append(meaning, ctx, remove)
      return li
    })
  )
}

async function renderSettings(): Promise<void> {
  const { hasSarashinaKey } = await window.settings.get()
  $<HTMLParagraphElement>('key-state').textContent = hasSarashinaKey
    ? 'キーは保存済みです。AI での絞り込みと意味の表示が有効になっています。'
    : 'キーが未設定です。今は規則だけで言葉を選んでいて、意味は表示されません。'
  $<HTMLButtonElement>('key-remove').hidden = !hasSarashinaKey
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
