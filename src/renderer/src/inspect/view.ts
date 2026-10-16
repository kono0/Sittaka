import { totals, wordConfidence, type Trace } from './trace'

type Judgment = Extract<NonNullable<Trace['ai']>, { status: 'ok' }>['judgments'][number]

const MAX_TRACES = 300
const SPEAKER: Record<Trace['speaker'], string> = { other: '相手', self: '自分' }
const REASON: Record<string, string> = {
  unknown: '辞書にない',
  'rare-kanji': '常用外の漢字',
  compound: '複合語',
  katakana: 'カタカナ語',
  acronym: '略語',
  organization: '組織名'
}

const LEVEL: Record<number, string> = {
  1: '1 = だれでも使う日常語',
  2: '2 = この分野で決まった意味で使う普通の言葉',
  3: '3 = 専門用語・業界用語',
  4: '4 = まず知らない専門用語・略語'
}

type Run = (text: string) => Promise<{ trace: Trace }>

/**
 * 検証タブ。発言ごとに「文字起こし → 区切り → 候補 → AI の判断 → 結果」を並べて、
 * どの段階で言葉が落ちているかを確かめられるようにする。
 */
export class Inspector {
  private traces: Trace[] = []
  private visible = false
  private readonly totalsEl: HTMLElement
  private readonly listEl: HTMLOListElement

  constructor(
    private readonly root: HTMLElement,
    private readonly run: Run
  ) {
    const form = el('form', 'inspect-form') as HTMLFormElement
    const input = el('textarea') as HTMLTextAreaElement
    input.rows = 2
    input.placeholder = '文を入れて試す（例: この変数のスコープは関数の中だけです）'
    const submit = el('button', '', 'この文で試す') as HTMLButtonElement
    submit.type = 'submit'
    form.append(input, submit)
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) return
      submit.disabled = true
      try {
        this.add((await this.run(text)).trace)
      } finally {
        submit.disabled = false
      }
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        form.requestSubmit()
      }
    })

    const tools = el('div', 'inspect-tools')
    const save = el('button', '', '記録を保存（JSON）') as HTMLButtonElement
    save.type = 'button'
    save.addEventListener('click', () => this.download())
    const clear = el('button', '', '記録を消す') as HTMLButtonElement
    clear.type = 'button'
    clear.addEventListener('click', () => {
      this.traces = []
      this.render()
    })
    tools.append(save, clear)

    this.totalsEl = el('div', 'inspect-totals')
    this.listEl = el('ol', 'inspect-list') as HTMLOListElement
    this.listEl.dataset.empty = '通話を始めるか、上の欄に文を入れると、ここに処理の中身が並びます'
    root.append(form, tools, this.totalsEl, this.listEl)
  }

  add(trace: Trace): void {
    this.traces.unshift(trace)
    if (this.traces.length > MAX_TRACES) this.traces.length = MAX_TRACES
    if (!this.visible) return
    this.renderTotals()
    this.listEl.prepend(this.item(trace, true))
    while (this.listEl.children.length > MAX_TRACES) this.listEl.lastElementChild?.remove()
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    // 中身が多いので、検証タブを開いている間はパネルを広げる
    void window.panel.setWide(visible)
    if (visible) this.render()
  }

  private render(): void {
    this.renderTotals()
    this.listEl.replaceChildren(...this.traces.map((t, i) => this.item(t, i === 0)))
  }

  private renderTotals(): void {
    const t = totals(this.traces)
    if (t.utterances === 0) {
      this.totalsEl.replaceChildren()
      return
    }
    const row = (label: string, value: string, hint?: string) => {
      const d = el('div', 'stat')
      d.append(el('span', 'label', label), el('span', 'value', value))
      if (hint) d.title = hint
      return d
    }
    this.totalsEl.replaceChildren(
      row('発言', String(t.utterances)),
      row('名詞（候補）', String(t.nouns), '形態素解析で見つかった名詞のまとまりの数。AI にはこれを全部渡す'),
      row('規則で選んだ', String(t.ruleHits), 'AI を使わないときに並ぶ言葉の数'),
      row('AI が残した', `${t.aiKept}（+${t.aiAdded}）`, '候補から残した数（かっこ内は候補にない言葉を足した数）'),
      row('最終的に並んだ', String(t.final)),
      row('AI 呼び出し', `${t.aiCalls}回・平均${t.aiAvgMs === null ? '-' : Math.round(t.aiAvgMs)}ms`),
      row('AI エラー / 省略', `${t.aiErrors} / ${t.aiSkipped}`, '省略は、キーがないか上限に近くて AI を通さなかった数')
    )
  }

  private item(t: Trace, open: boolean): HTMLLIElement {
    const li = el('li') as HTMLLIElement
    const details = el('details') as HTMLDetailsElement
    details.open = open
    const summary = el('summary')
    summary.append(
      el('span', `who ${t.speaker}`, t.source === 'manual' ? '手入力' : SPEAKER[t.speaker]),
      el('span', 'text', t.text),
      el('span', `count ${t.final.length ? '' : 'zero'}`, `${t.final.length}語`)
    )
    details.append(summary)

    // ① 文字起こし
    details.append(
      stage(
        '1. 文字起こし',
        confidenceText(t),
        t.asr
          ? el(
              'p',
              'note',
              `遅れ ${sec(t.asr.latencyMs)} ・ 処理 ${sec(t.asr.inferenceMs)}（音声 ${sec(t.asr.audioMs)}）・ ${t.text.length}文字`
            )
          : el('p', 'note', '手入力（文字起こしは通していません）'),
        ...(t.asr?.tokens
          ? [el('p', 'note', '下線 = 音声認識の自信が低い文字（点線 80%未満・赤 50%未満）。文字にカーソルを乗せると確率が出ます')]
          : [])
      )
    )

    const x = t.extracted
    if (!x) {
      details.append(stage('エラー', el('p', 'error', t.error ?? '形態素解析に失敗しました')))
      li.append(details)
      return li
    }

    // ② 区切り
    const tokens = el('div', 'tokens')
    for (const tok of x.tokens) {
      const s = el('span', `tok ${tok.pos.startsWith('名詞') ? 'noun' : ''} ${tok.known ? '' : 'unknown'}`, tok.surface)
      s.title = `${tok.pos}${tok.known ? '' : '（辞書にない）'}`
      tokens.append(s)
    }
    details.append(
      stage(
        '2. 単語への区切り（kuromoji）',
        tokens,
        el('p', 'note', '色付き = 名詞、点線 = 辞書にない言葉。言葉にカーソルを乗せると品詞が出ます')
      )
    )

    // ③ 候補
    const ruleSet = new Map(x.terms.map((r) => [r.text, r.reasons]))
    const candidates = el('div', 'chips')
    for (const n of x.nouns) {
      const reasons = ruleSet.get(n)
      const c = el('span', `pill ${reasons ? 'rule' : ''}`, n)
      if (reasons) c.title = `規則でも選ばれる: ${reasons.map((r) => REASON[r] ?? r).join('・')}`
      candidates.append(c)
    }
    if (!x.nouns.length) candidates.append(el('span', 'note', '名詞が見つかりませんでした'))
    details.append(
      stage(
        `3. 候補（名詞のまとまり ${x.nouns.length}個・うち規則で選ばれる ${x.terms.length}個）`,
        candidates,
        el('p', 'note', '太枠 = 規則でも選ばれる言葉。AI にはこの候補を全部渡します')
      )
    )

    // ④ AI
    details.append(this.aiStage(t))

    // ⑤ 結果
    const final = el('div', 'chips')
    for (const f of t.final) final.append(el('span', 'pill final', f))
    if (!t.final.length) final.append(el('span', 'note', 'なし'))
    details.append(stage(`5. 結果（${t.decidedBy === 'ai' ? 'AI の判断' : '規則だけ'}で決定）`, final))

    li.append(details)
    return li
  }

  private aiStage(t: Trace): HTMLElement {
    const ai = t.ai
    if (!ai) return stage('4. Sarashina', el('p', 'note', '候補がないので呼んでいません'))
    if (ai.status === 'no-key') return stage('4. Sarashina', el('p', 'note', 'API キーがないので呼んでいません'))
    if (ai.status === 'busy') {
      return stage(
        '4. Sarashina',
        el('p', 'note', `1分あたりの上限に近く、${sec(ai.waitMs)}待ちになるので省略しました`)
      )
    }
    const body: Node[] = []
    if (ai.status === 'error') {
      body.push(el('p', 'error', `エラー: ${ai.error}（${ai.ms}ms）`))
    } else {
      const level = (n: number) => el('span', `level l${n}`, String(n))
      const group = (label: string, items: Judgment[], cls: (j: Judgment) => string) => {
        const d = el('div', 'ai-group')
        d.append(el('span', 'label', `${label}（${items.length}）`))
        const chips = el('div', 'chips')
        for (const j of items) {
          const p = el('span', `pill ${cls(j)}`)
          p.append(j.candidate === j.text ? j.text : `${j.candidate} → ${j.text}`, level(j.level))
          const conf = wordConfidence(t.asr?.tokens, j.candidate)
          if (conf !== null) p.append(el('span', `conf ${confClass(conf)}`, `${Math.round(conf * 100)}%`))
          p.title = `${LEVEL[j.level] ?? ''}${j.kept ? '（残した）' : '（外した）'}${
            conf === null ? '' : `・音声認識の自信 ${Math.round(conf * 100)}%（言葉の中でいちばん低い文字）`
          }`
          chips.append(p)
        }
        if (!items.length) chips.append(el('span', 'note', 'なし'))
        d.append(chips)
        return d
      }
      const judged = new Set(ai.judgments.filter((j) => !j.added).map((j) => j.candidate))
      const missing = (t.extracted?.nouns ?? []).filter((n) => !judged.has(n))
      body.push(
        el(
          'p',
          'note',
          `応答 ${ai.ms}ms ・ 数字は AI の採点（1 日常語 〜 4 難しい専門用語）。設定の「拾う量」で残す段階が変わります`
        ),
        group(
          '候補の採点',
          ai.judgments.filter((j) => !j.added),
          (j) => (j.kept ? 'kept' : 'dropped')
        ),
        group(
          'AI が足した言葉',
          ai.judgments.filter((j) => j.added),
          (j) => (j.kept ? 'added' : 'dropped')
        )
      )
      if (missing.length) body.push(el('p', 'error', `AI が採点しなかった候補: ${missing.join('、')}`))
    }
    body.push(fold('AI に送った文', ai.prompt), fold('AI が返したそのままの答え', ai.raw || '（空）'))
    return stage('4. Sarashina の判断（sarashina3-nano）', ...body)
  }

  private download(): void {
    const blob = new Blob([JSON.stringify([...this.traces].reverse(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `talking-word-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
}

function el(tag: string, className = '', text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className.trim()) e.className = className.trim().replace(/\s+/g, ' ')
  if (text !== undefined) e.textContent = text
  return e
}

function stage(title: string, ...children: Node[]): HTMLElement {
  const s = el('section', 'stage')
  s.append(el('h3', '', title), ...children)
  return s
}

function fold(title: string, text: string): HTMLElement {
  const d = el('details', 'fold')
  d.append(el('summary', '', title), el('pre', '', text))
  return d
}

function sec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}秒`
}

const confClass = (p: number) => (p < 0.5 ? 'low' : p < 0.8 ? 'mid' : 'high')

/** 文字起こしを、文字ごとの自信の度合いで印を付けて表示する */
function confidenceText(t: Trace): HTMLElement {
  const p = el('p', 'mono')
  const tokens = t.asr?.tokens
  if (!tokens?.length) {
    p.textContent = t.text
    return p
  }
  for (const tok of tokens) {
    const s = el('span', `ch ${confClass(tok.p)}`, tok.text)
    s.title = `${Math.round(tok.p * 100)}%`
    p.append(s)
  }
  return p
}
