import type { ProviderId } from '../../preload/api'
import { PROVIDER_NOTES, PROVIDER_OPTIONS } from './providers'

const DONE_KEY = 'onboarded'

export function needsOnboarding(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) !== '1'
  } catch {
    return false
  }
}

interface Options {
  /** 設定タブのマイクの選択肢。案内ではこれを写して使い、選んだら設定側にも反映する */
  micSelect: HTMLSelectElement
  /** 聞き取り中か。聞き取り中はモデルが読み込み済みなので、ダウンロードの画面を飛ばす */
  isRunning(): boolean
  onDone(): void
}

/**
 * 初めて起動したときの案内。使い方とデータの扱いを説明し、
 * 音声モデルのダウンロード・マイク・AI のキーを順に済ませてもらう（どれも後から設定で変えられる）。
 */
export function showOnboarding({ micSelect, isRunning, onDone }: Options): void {
  const overlay = el('div', 'onboarding')
  const card = el('div', 'onboarding-card')
  overlay.append(card)
  document.body.append(overlay)

  const steps = [welcome, model, mic, ai]
  let index = 0
  // 聞き取り中に案内を開き直したときは、動いているエンジンを止めないよう準備済みとして扱う
  let modelReady = isRunning()

  const finish = () => {
    try {
      localStorage.setItem(DONE_KEY, '1')
    } catch {
      // 保存できなくても今回は閉じる
    }
    overlay.remove()
    onDone()
  }

  const show = () => {
    const { title, body, next, nextLabel } = steps[index]()
    const dots = el('div', 'dots')
    steps.forEach((_, i) => dots.append(el('span', i === index ? 'on' : '')))
    const back = button('戻る', () => {
      index--
      show()
    })
    back.hidden = index === 0
    const forward = button(nextLabel ?? (index === steps.length - 1 ? 'はじめる' : '次へ'), async () => {
      forward.disabled = true
      try {
        if (next) await next()
      } finally {
        forward.disabled = false
      }
      if (index === steps.length - 1) return finish()
      index++
      show()
    })
    forward.classList.add('primary')
    const nav = el('div', 'onboarding-nav')
    nav.append(back, dots, forward)
    card.replaceChildren(el('h2', '', title), ...body, nav)
  }

  function welcome(): Step {
    return {
      title: 'Sittaka へようこそ',
      body: [
        p('通話の声を聞き取って、会話に出てきた専門用語やカタカナ語を、この画面の端にそっと並べます。'),
        list([
          '通話を始めたら「開始」を押します',
          '知らない言葉を押す（または Ctrl+Alt+数字）とキープされ、意味が表示されます',
          'このパネルは画面共有や録画には映りません'
        ]),
        el('h3', '', 'データの扱い'),
        list([
          '音声は PC の中だけで文字にします。音声をどこかに送ったり、保存したりはしません',
          'AI を使う場合は、文字にした会話の一部を、あなたが選んだ AI に送ります'
        ])
      ]
    }
  }

  function model(): Step {
    const status = p(modelReady ? 'ダウンロード済みです。' : '')
    const bar = el('progress', '') as HTMLProgressElement
    bar.max = 100
    bar.hidden = true
    return {
      title: '音声認識の準備',
      body: [
        p(
          '会話を文字にする ReazonSpeech（日本語専用）を、この PC にダウンロードします。約160MB で、最初の1回だけです。'
        ),
        bar,
        status
      ],
      nextLabel: modelReady ? '次へ' : 'ダウンロードする',
      next: async () => {
        if (modelReady) return
        bar.hidden = false
        try {
          await window.asr.load((pr) => {
            status.textContent = pr.message
            if (pr.percent == null) bar.removeAttribute('value')
            else bar.value = pr.percent
          })
          modelReady = true
          // 準備ができたかを確かめただけなので、聞き取りを始めるまで止めておく
          await window.asr.stop()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          status.textContent = `ダウンロードできませんでした（${msg}）。あとで「開始」を押したときにもう一度試します。`
          bar.hidden = true
          modelReady = false
        }
      }
    }
  }

  function mic(): Step {
    const select = el('select', '') as HTMLSelectElement
    select.append(...[...micSelect.options].map((o) => new Option(o.text, o.value)))
    select.value = micSelect.value
    select.addEventListener('change', () => {
      micSelect.value = select.value
      micSelect.dispatchEvent(new Event('change'))
    })
    return {
      title: '自分の声のマイク',
      body: [
        p('相手の声は PC から出る音をそのまま取り込みます。ここでは、自分の声を拾うマイクを選びます。'),
        select,
        p(
          'Bluetooth のイヤホンのマイクを選ぶと、イヤホンの音質が落ちることがあります。そのときは PC 内蔵のマイクか「使わない」を選んでください。',
          'note'
        )
      ]
    }
  }

  function ai(): Step {
    const select = el('select', '') as HTMLSelectElement
    select.append(...PROVIDER_OPTIONS.map(([id, label]) => new Option(label, id)))
    const note = p('', 'note')
    const input = el('input', '') as HTMLInputElement
    input.type = 'password'
    input.autocomplete = 'off'
    const error = p('', 'error')
    let saved: Partial<Record<ProviderId, boolean>> = {}
    const refresh = () => {
      const id = select.value as ProviderId
      note.textContent = PROVIDER_NOTES[id]
      input.placeholder = saved[id] ? 'キーは保存済みです' : 'API キーを貼り付け（あとでも入れられます）'
    }
    select.addEventListener('change', refresh)
    void window.settings.get().then((s) => {
      saved = s.keys
      select.value = s.provider
      refresh()
    })
    return {
      title: 'AI で言葉を絞り込む（任意）',
      body: [
        p(
          'AI のキーを入れると、日常語を外して難しい言葉だけを残し、キープした言葉の意味を会話に合わせて表示します。キーがなくても、言葉を並べる機能は使えます。'
        ),
        select,
        note,
        input,
        error
      ],
      next: async () => {
        const provider = select.value as ProviderId
        await window.settings.setProvider(provider)
        if (!input.value.trim()) return
        try {
          await window.settings.setKey(provider, input.value)
        } catch (err) {
          error.textContent = `キーを保存できませんでした: ${(err instanceof Error ? err.message : String(err)).replace(/^.*Error: /, '')}`
          throw err
        }
      }
    }
  }

  show()
}

interface Step {
  title: string
  body: Node[]
  next?: () => Promise<void>
  nextLabel?: string
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function p(text: string, cls = ''): HTMLElement {
  return el('p', cls, text)
}

function list(items: string[]): HTMLElement {
  const ul = el('ul', '')
  for (const i of items) ul.append(el('li', '', i))
  return ul
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', '', text) as HTMLButtonElement
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}
