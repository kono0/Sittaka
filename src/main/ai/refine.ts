import type { ChatClient, ChatTrace } from './chat'

export interface RefinedTerm {
  text: string
  reading: string
}

/** AI が1つの言葉をどう見たか（検証タブで見せる） */
export interface Judgment {
  /** 候補として渡した言葉（足した言葉は text と同じ） */
  candidate: string
  /** 表記を直したあとの言葉 */
  text: string
  /** 1〜4。大きいほど調べたくなる言葉 */
  level: number
  added: boolean
  kept: boolean
}

export interface RefineOutput {
  terms: RefinedTerm[]
  judgments: Judgment[]
}

const ITEM = {
  type: 'object',
  properties: {
    candidate: { type: 'string' },
    text: { type: 'string' },
    reading: { type: 'string' },
    level: { type: 'integer' }
  },
  required: ['candidate', 'text', 'reading', 'level'],
  additionalProperties: false
}

const SCHEMA = {
  type: 'object',
  properties: {
    candidates: { type: 'array', items: ITEM },
    added: { type: 'array', items: ITEM }
  },
  required: ['candidates', 'added'],
  additionalProperties: false
}

/** どのくらい拾うか。使う人の知識や好みで変えられるようにする */
export type Amount = 'few' | 'normal' | 'many'

/** この段階以上の言葉を残す */
export const MIN_LEVEL: Record<Amount, number> = { few: 4, normal: 3, many: 2 }

const MAX_ADDED: Record<Amount, number> = { few: 2, normal: 3, many: 5 }

const MAX_TERMS = 8

function systemPrompt(): string {
  return `あなたは、オンライン通話を聞いている人のために、会話に出てきた言葉が「意味を確かめたくなる言葉」かどうかを判定するアシスタントです。
入力は音声認識の結果なので、句読点がなく、同音異義語の漢字を間違えていることがあります。
「候補」は発言の中の名詞を機械的に並べたもので、日常語も混ざっています。

「候補」のすべての言葉について、1つずつ candidates に次を書いてください。1つも省かないこと。
- candidate: 候補の言葉そのまま
- text: 正しい表記。会話の流れから見て漢字の変換が間違っていれば直す。区切りを誤ってつないだ言葉なら、中心になる言葉に切り直す
- reading: text の読みをひらがなで（英字の略語も、例: KPI → けーぴーあい）
- level: 次の4段階
  1 = だれでも日常的に使う言葉（今日、文字、確認、両方、数字）
  2 = 普通の言葉だが、この会話の分野では決まった意味で使われている（プログラミングの話での「実行」「表示」など）
  3 = その分野の専門用語・業界用語・カタカナ語（変数、代入、スコープ、アンダースコア、リードタイム）
  4 = 一般の人はまず知らない専門用語・略語・難しい熟語（冪等性、KPI、担保、デューデリジェンス）

同じ言葉が前の発言で出ていても、毎回同じ基準で判定してください。

「今の発言」の中に、候補から漏れた level 3 以上の言葉があれば added に同じ形で書く（candidate には text と同じものを書く）。なければ空の配列。`
}

/**
 * 名詞の候補を、前後の会話を見ながら AI に1つずつ採点させ、漢字の誤変換を直させる。
 * 「残す・外す」を直接選ばせると候補の数によって判断がぶれたので、段階で採点させて
 * どこから残すかはこちらで決める。速さと回数の上限（1分60回）を優先して nano を使う。
 */
export async function refineTerms(
  client: ChatClient,
  context: string[],
  utterance: string,
  candidates: string[],
  amount: Amount = 'normal',
  trace?: ChatTrace & { prompt?: string }
): Promise<RefineOutput> {
  const user = [
    context.length ? `直前の会話:\n${context.join('\n')}` : '直前の会話: なし',
    `今の発言: ${utterance}`,
    `候補: ${candidates.length ? candidates.join('、') : 'なし'}`
  ].join('\n\n')
  if (trace) trace.prompt = user
  const out = await client.json<{ candidates?: Item[]; added?: Item[] }>(
    'sarashina3-nano',
    [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: user }
    ],
    SCHEMA,
    1200,
    trace
  )

  const min = MIN_LEVEL[amount]
  const judgments: Judgment[] = []
  const terms: RefinedTerm[] = []
  const seen = new Set<string>()
  const consider = (item: Item, added: boolean) => {
    const text = clean(item.text) || clean(item.candidate)
    const level = Math.min(4, Math.max(1, Math.round(Number(item.level) || 1)))
    const ok = text.length >= 2 && text.length <= 30 && !seen.has(text)
    const kept = ok && level >= min && terms.length < MAX_TERMS
    judgments.push({ candidate: clean(item.candidate) || text, text, level, added, kept })
    if (!ok) return
    seen.add(text)
    if (kept) terms.push({ text, reading: hiraganaOnly(item.reading) })
  }
  for (const item of out.candidates ?? []) consider(item, false)
  for (const item of (out.added ?? []).slice(0, MAX_ADDED[amount])) consider(item, true)
  return { terms, judgments }
}

interface Item {
  candidate?: unknown
  text?: unknown
  reading?: unknown
  level?: unknown
}

function clean(v: unknown): string {
  return String(v ?? '').trim()
}

/** 「あlphabet」のように崩れた読みは使わない */
function hiraganaOnly(v: unknown): string {
  const s = clean(v)
  return /^[\p{Script=Hiragana}ー]+$/u.test(s) ? s : ''
}
