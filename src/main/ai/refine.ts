import type { ChatClient, ChatTrace } from './chat'

export interface RefinedTerm {
  text: string
  reading: string
}

const SCHEMA = {
  type: 'object',
  properties: {
    terms: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, reading: { type: 'string' } },
        required: ['text', 'reading'],
        additionalProperties: false
      }
    }
  },
  required: ['terms'],
  additionalProperties: false
}

/** どのくらい拾うか。使う人の知識や好みで変えられるようにする */
export type Amount = 'few' | 'normal' | 'many'

const KEEP_RULE: Record<Amount, string> = {
  few: '一般的な社会人が意味を知らない可能性が高い言葉（専門用語、業界用語、略語、難しい熟語）だけを残す。',
  normal:
    '専門用語、業界用語、カタカナのビジネス用語、略語、やや難しい熟語は残す。迷ったら残す。日常会話でだれもが使う言葉（会議、メール、今日など）だけを外す。',
  many: '日常会話でだれもが使う言葉（会議、メール、今日など）以外は、ほとんど残す。'
}

const MAX_ADDED: Record<Amount, number> = { few: 2, normal: 3, many: 5 }

function systemPrompt(amount: Amount): string {
  return `あなたは、オンライン通話を聞いている人のために「意味を確かめたくなるかもしれない言葉」を選ぶアシスタントです。
入力は音声認識の結果なので、句読点がなく、同音異義語の漢字を間違えていることがあります。

「候補」は発言の中の名詞を機械的に並べたもので、日常語も混ざっている。

やること:
1. 「候補」について: ${KEEP_RULE[amount]} 文の区切りを誤ってつないだだけの言葉は、正しい言葉に切り直すか外す。
2. 会話の流れから見て漢字の変換が間違っていれば、正しい表記に直す。
3. 「今の発言」の中に、候補から漏れた言葉で同じ基準に当てはまるもの（「担保」「仕様」のような漢字の専門用語も含む）があれば${MAX_ADDED[amount]}つまで足す。
4. reading は言葉の読みをひらがなで書く。英字の略語も読みをひらがなで書く（例: KPI → けーぴーあい）。

該当がなければ terms を空の配列にする。最大8語。`
}

/**
 * 規則で拾った候補を、前後の会話を見ながら AI に絞り込ませ、漢字の誤変換を直させる。
 * 速さと回数の上限（1分60回）を優先して nano を使う。
 */
export async function refineTerms(
  client: ChatClient,
  context: string[],
  utterance: string,
  candidates: string[],
  amount: Amount = 'normal',
  trace?: ChatTrace & { prompt?: string }
): Promise<RefinedTerm[]> {
  const user = [
    context.length ? `直前の会話:\n${context.join('\n')}` : '直前の会話: なし',
    `今の発言: ${utterance}`,
    `候補: ${candidates.length ? candidates.join('、') : 'なし'}`
  ].join('\n\n')
  if (trace) trace.prompt = user
  const out = await client.json<{ terms?: RefinedTerm[] }>(
    'sarashina3-nano',
    [
      { role: 'system', content: systemPrompt(amount) },
      { role: 'user', content: user }
    ],
    SCHEMA,
    600,
    trace
  )
  const seen = new Set<string>()
  return (out.terms ?? [])
    .map((t) => ({ text: String(t.text ?? '').trim(), reading: String(t.reading ?? '').trim() }))
    .filter((t) => t.text.length >= 2 && t.text.length <= 30 && !seen.has(t.text) && seen.add(t.text))
    .slice(0, 8)
}
