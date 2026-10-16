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
- text: 正しい表記。会話の流れから見て漢字の変換が間違っていれば直す。同じ言葉の言い直しがつながっていれば1つにする（「伝導イヤホン骨伝導イヤホン」→「骨伝導イヤホン」）
- reading: text の読みをひらがなで（英字の略語も、例: KPI → けーぴーあい）
- level: 次の4段階。「その分野に詳しくない普通の大人が聞いて、意味が分かるか」で決める
  1 = だれでも意味が分かる言葉。日常的に使うカタカナ語や、よく知られた商品・会社・サービスの名前もここ（今日、文字、確認、特徴、説明、画面、結果、交通事故、デザイン、セール、iPhone、PC）
  2 = 普通の言葉だが、この分野では日常と違う決まった意味で使われている（プログラミングの話での「実行」「引数」、会計の話での「資産」など）。日常と同じ意味なら 1
  3 = その分野の専門用語・業界用語・一般にはあまり知られていない製品名（変数、代入、スコープ、リードタイム、骨伝導イヤホン）
  4 = 一般の人はまず知らない専門用語・略語・難しい熟語（冪等性、KPI、担保、デューデリジェンス）

迷ったら低いほうにしてください。同じ言葉が前の発言で出ていても、毎回同じ基準で判定してください。

音声認識の聞き間違いに気をつけてください。会話の話題に合わない言葉や、実在しない言葉は、聞き間違いの可能性が高いです。
- 「これまでに出た言葉」や前後の会話から、音の近い正しい言葉が分かれば text を直す（例: プログラミングの話での「資源語」→「C言語」、脳の話での「カンマン」→「海馬」）。level は直したあとの言葉で付ける
- 直し方が分からない、意味の通らない言葉は level 1 にする（でたらめな言葉を表示しないため）
- 2つの言葉が誤ってつながっている候補は、text に「、」で区切って書く（例: 「山田東京」→「山田、東京」）
- 英字の言葉の途中に空白を入れない（「Frin tf」ではなく「printf」）

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
  trace?: ChatTrace & { prompt?: string },
  memory?: LevelMemory
): Promise<RefineOutput> {
  const seenWords = memory?.recent(20) ?? []
  const user = [
    ...(seenWords.length ? [`これまでに出た言葉: ${seenWords.join('、')}`] : []),
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
    const candidate = clean(item.candidate) || clean(item.text)
    const scored = Math.min(4, Math.max(1, Math.round(Number(item.level) || 1)))
    // 誤ってつながった言葉は、AI が「、」や空白で区切って返す
    const parts = (clean(item.text) || candidate).split(/[\s、,]+/).filter(Boolean)
    for (const text of parts) {
      const level = memory ? memory.settle(text, scored) : scored
      const ok = text.length >= 2 && text.length <= 30 && !seen.has(text)
      const kept = ok && level >= min && terms.length < MAX_TERMS
      judgments.push({ candidate, text, level, added, kept })
      if (!ok) continue
      seen.add(text)
      // 区切ったときは読みがどこまでか分からないので、辞書の読みにまかせる
      if (kept) terms.push({ text, reading: parts.length === 1 ? hiraganaOnly(item.reading) : '' })
    }
  }
  for (const item of out.candidates ?? []) consider(item, false)
  for (const item of (out.added ?? []).slice(0, MAX_ADDED[amount])) consider(item, true)
  return { terms, judgments }
}

/**
 * 同じ言葉の段階が発言ごとにぶれる（「プログラム」が1になったり3になったり）ので、
 * 言葉ごとにこれまでの判定を覚えておき、いちばん多かった段階を使う（同数なら先に付いたほう）。
 * 覚えた言葉は、聞き間違いを直す手がかりとして AI にも渡す。
 */
export class LevelMemory {
  private words = new Map<string, { text: string; counts: number[]; first: number }>()

  constructor(private readonly limit = 1000) {}

  settle(text: string, level: number): number {
    const key = text.replace(/\s+/g, '').toLowerCase()
    const entry = this.words.get(key) ?? { text, counts: [0, 0, 0, 0, 0], first: level }
    entry.counts[level]++
    // 最近出た順に並べ直す
    this.words.delete(key)
    this.words.set(key, entry)
    if (this.words.size > this.limit) this.words.delete(this.words.keys().next().value!)
    let best = entry.first
    for (let l = 1; l <= 4; l++) if (entry.counts[l] > entry.counts[best]) best = l
    return best
  }

  /** 最近出た言葉（新しい順） */
  recent(n: number): string[] {
    return [...this.words.values()].slice(-n).reverse().map((e) => e.text)
  }

  clear(): void {
    this.words.clear()
  }
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

/** カタカナの読みはひらがなにそろえ、「あlphabet」のように崩れた読みは使わない */
function hiraganaOnly(v: unknown): string {
  const s = clean(v).replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
  return /^[\p{Script=Hiragana}ー]+$/u.test(s) ? s : ''
}
