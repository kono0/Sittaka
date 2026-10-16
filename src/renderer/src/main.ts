import { CallCapture, type Speaker } from './audio/capture'
import { hasWebGPU, LocalWhisperTranscriber, whisperPresets } from './asr/local-whisper'
import { TranscriptionQueue, type TranscriptLine } from './asr/queue'
import { ReazonSpeechTranscriber } from './asr/reazonspeech'
import type { Transcriber } from './asr/transcriber'
import { Inspector } from './inspect/view'
import { WordbookView } from './wordbook/view'
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
const levelBars: Record<Speaker, HTMLElement> = {
  other: $('level-other'),
  self: $('level-self')
}
const miniWordsEl = $<HTMLDivElement>('mini-words')
const miniKeptEl = $<HTMLDivElement>('mini-kept')
const recDot = $<HTMLSpanElement>('rec')
/** 小さい表示で出す言葉の数 */
const MINI_SLOTS = 3

/** 音量のバー。0.3 で振り切る */
function setLevel(speaker: Speaker, level: number): void {
  levelBars[speaker].style.width = `${Math.min(100, (level / 0.3) * 100)}%`
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
const wordbookView = new WordbookView($('wordbook'))
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
$<HTMLButtonElement>('close').addEventListener('click', () => window.close())

// 表示の大きさ: full（縦長のパネル）と mini（画面の端の小さな帯）
type Mode = 'full' | 'mini'
let mode: Mode = 'full'
try {
  if (localStorage.getItem('mode') === 'mini') mode = 'mini'
} catch {
  // 保存できない環境でも既定値で動く
}
const modeButton = $<HTMLButtonElement>('mode')
function setMode(next: Mode): void {
  mode = next
  document.body.classList.toggle('mini', mode === 'mini')
  document.body.classList.toggle('full', mode === 'full')
  modeButton.title = mode === 'mini' ? '広げる（Ctrl+Alt+M）' : '小さくする（Ctrl+Alt+M）'
  modeButton.setAttribute('aria-label', mode === 'mini' ? '広げる' : '小さくする')
  void window.panel.setMode(mode)
  try {
    localStorage.setItem('mode', mode)
  } catch {
    // 無視
  }
}
modeButton.addEventListener('click', () => setMode(mode === 'mini' ? 'full' : 'mini'))
window.hotkeys.onToggleMode(() => setMode(mode === 'mini' ? 'full' : 'mini'))
setMode(mode)

// 会話ログを開いたときは最新の行を見せる
$<HTMLDetailsElement>('log').addEventListener('toggle', () => (transcript.scrollTop = transcript.scrollHeight))

window.hotkeys.onKeep((n) => {
  // 画面に見えている並びの N 番目（並びを止めている間もずれないように）
  const w = shownWords[n - 1]
  if (w) keepWord(w.text)
})

// タブ（会話・単語帳・設定）の切り替え
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs button')]
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const t of tabs) t.classList.toggle('active', t === tab)
    for (const v of document.querySelectorAll<HTMLElement>('.view')) v.hidden = v.dataset.view !== tab.dataset.view
    if (tab.dataset.view === 'wordbook') void wordbookView.render()
    if (tab.dataset.view === 'settings') {
      void renderSettings()
      void renderMics()
    }
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

const micSelect = $<HTMLSelectElement>('mic')
let micDevice = 'default'
try {
  micDevice = localStorage.getItem('mic') ?? 'default'
} catch {
  // 保存できない環境でも既定値で動く
}
// Windows での Bluetooth マイクの名前（「ヘッドセット (… Hands-Free)」など）
const BLUETOOTH_MIC = /bluetooth|hands-?free|ハンズフリー|airpods|buds/i

async function renderMics(): Promise<void> {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'
  )
  const options = [new Option('Windows の既定のマイク', 'default'), new Option('使わない（相手の声だけ）', 'off')]
  devices.forEach((d, i) => {
    const label = d.label || `マイク ${i + 1}`
    options.push(new Option(BLUETOOTH_MIC.test(label) ? `${label}（Bluetooth・音質が落ちます）` : label, d.deviceId))
  })
  // 選んでいたマイクが外されていても、選択は残しておく（つなぎ直したら戻る）
  if (!options.some((o) => o.value === micDevice)) options.push(new Option('（外されたマイク）', micDevice))
  micSelect.replaceChildren(...options)
  micSelect.value = micDevice
}
micSelect.addEventListener('change', () => {
  micDevice = micSelect.value
  try {
    localStorage.setItem('mic', micDevice)
  } catch {
    // 無視
  }
  capture?.refresh()
})
navigator.mediaDevices.addEventListener('devicechange', () => void renderMics())
void renderMics()

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
  document.body.classList.add('running')
  recDot.title = '聞き取り中'
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
      onLevel: setLevel,
      onSegment: (speaker, seg, capturedAt) => {
        // モデルの準備が終わるまでの発話は捨てる
        queue?.push(speaker, seg.audio, capturedAt)
        renderStats()
      },
      micDevice: () => micDevice,
      onReconnect: (error) => {
        setLevel('self', 0)
        setLevel('other', 0)
        status.textContent = error
          ? `音声の取り込み直しに失敗しました: ${error}（停止して開始し直してください）`
          : '音声機器の変更に合わせて、取り込み直しました'
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
  document.body.classList.remove('running')
  recDot.title = '停止中'
  engineSelect.disabled = false
  setLevel('other', 0)
  setLevel('self', 0)
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

/** 直近の会話（AI に渡す文脈）。話し手を付けて最大7発話（今の発言を含む） */
function recentContext(): string[] {
  return history.slice(-7).map((l) => `${SPEAKER_LABEL[l.speaker]}: ${l.text}`)
}

async function findTermsForLine(line: TranscriptLine, body: HTMLElement): Promise<void> {
  const context = recentContext()
  const { trace, terms } = await findTerms(line.text, line.speaker, context.slice(0, -1), amount)
  trace.asr = { latencyMs: line.latencyMs, inferenceMs: line.inferenceMs, audioMs: line.audioMs, tokens: line.tokens }
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

/**
 * 言葉の一覧にマウスを乗せている間は並びを止める（流れていって押しにくいため）。
 * その間に来た言葉は数だけ出し、マウスを離したらまとめて反映する。
 */
let shownWords: BoardWord[] = []
const pausedBadges = [...document.querySelectorAll<HTMLElement>('.paused-badge')]
// 描き直すと :hover やマウスの出入りのイベントが一瞬外れるので、マウスの位置で判定する
let pointer: { x: number; y: number } | null = null
const inside = (el: HTMLElement) => {
  if (!pointer || el.offsetParent === null) return false
  // 上の表示が増えて一覧が少しずれても止まったままになるよう、周りに余裕を持たせる
  const r = el.getBoundingClientRect()
  const m = 24
  return pointer.x >= r.left - m && pointer.x <= r.right + m && pointer.y >= r.top - m && pointer.y <= r.bottom + m
}
const isPaused = () => inside(wordsEl) || inside(miniWordsEl)
let wasPaused = false
document.addEventListener('mousemove', (e) => {
  pointer = { x: e.clientX, y: e.clientY }
  if (wasPaused && !isPaused()) renderBoard()
})
document.documentElement.addEventListener('mouseleave', () => {
  pointer = null
  if (wasPaused) renderBoard()
})

function renderBoard(): void {
  const kept = board.kept().reverse()
  const recent = board.recent()
  const paused = isPaused()
  wasPaused = paused
  if (paused) {
    // キープした・消えた言葉だけ外し、並びはそのまま
    shownWords = shownWords.filter((w) => w.keptAt === null && board.get(w.text) === w)
  } else {
    shownWords = recent
  }
  const shown = new Set(shownWords)
  const waiting = recent.filter((w) => !shown.has(w)).length
  for (const b of pausedBadges) {
    b.hidden = !paused
    b.textContent = waiting ? `止めています・新しい言葉 ${waiting}` : '止めています'
  }
  // 新しくキープしたものほど上に
  keptEl.replaceChildren(...kept.map(card))
  wordsEl.replaceChildren(...shownWords.map((w, i) => chip(w, i < HOTKEY_SLOTS ? i + 1 : null, () => keepWord(w.text))))
  // 小さい表示: 直近の言葉3つと、最後にキープした言葉だけ
  miniWordsEl.replaceChildren(...shownWords.slice(0, MINI_SLOTS).map((w, i) => chip(w, i + 1, () => keepWord(w.text))))
  miniKeptEl.replaceChildren(...kept.slice(0, 1).map(card))
}

/** 出てきたばかりの言葉・キープしたばかりの言葉だけ、ふわっと出す（描き直すたびに全部が動かないように） */
const FRESH_MS = 1000
const isFresh = (t: number | null) => t !== null && Date.now() - t < FRESH_MS

/** キープした言葉。意味が届いたら下に出す */
function card(w: BoardWord): HTMLElement {
  const el = document.createElement('div')
  el.className = `card ${isFresh(w.keptAt) ? 'fresh' : ''}`
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

async function renderSettings(): Promise<void> {
  const { hasSarashinaKey } = await window.settings.get()
  $<HTMLParagraphElement>('key-state').textContent = hasSarashinaKey
    ? 'キーは保存済みです。AI での絞り込みと意味の表示が有効になっています。'
    : 'キーが未設定です。今は規則だけで言葉を選んでいて、意味は表示されません。'
  $<HTMLButtonElement>('key-remove').hidden = !hasSarashinaKey
}

function chip(w: BoardWord, num: number | null, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = `chip ${w.speaker} ${isFresh(w.lastSeen) ? 'fresh' : ''}`
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
