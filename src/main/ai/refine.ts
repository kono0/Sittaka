import type { ChatClient } from './chat'

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

const SYSTEM = `あなたは、オンライン通話を聞いている人のために「意味を知らないかもしれない言葉」を選ぶアシスタントです。
入力は音声認識の結果なので、句読点がなく、同音異義語の漢字を間違えていることがあります。

やること:
1. 「候補」から、一般的な社会人が意味を知らない可能性がある言葉（専門用語、業界用語、カタカナのビジネス用語、略語、難しい熟語）だけを残す。誰でも知っている言葉や、文の区切りを誤ってつないだだけの言葉は外す。
2. 会話の流れから見て漢字の変換が間違っていれば、正しい表記に直す。
3. 「今の発言」の中に、候補から漏れた難しい言葉があれば2つまで足してよい。
4. reading は言葉の読みをひらがなで書く。英字の略語は読み方をカタカナではなくひらがなで書く（例: KPI → けーぴーあい）。

該当がなければ terms を空の配列にする。最大5語。`

/**
 * 規則で拾った候補を、前後の会話を見ながら AI に絞り込ませ、漢字の誤変換を直させる。
 * 速さと回数の上限（1分60回）を優先して nano を使う。
 */
export async function refineTerms(
  client: ChatClient,
  context: string[],
  utterance: string,
  candidates: string[]
): Promise<RefinedTerm[]> {
  const user = [
    context.length ? `直前の会話:\n${context.join('\n')}` : '直前の会話: なし',
    `今の発言: ${utterance}`,
    `候補: ${candidates.length ? candidates.join('、') : 'なし'}`
  ].join('\n\n')
  const out = await client.json<{ terms?: RefinedTerm[] }>(
    'sarashina3-nano',
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user }
    ],
    SCHEMA,
    400
  )
  const seen = new Set<string>()
  return (out.terms ?? [])
    .map((t) => ({ text: String(t.text ?? '').trim(), reading: String(t.reading ?? '').trim() }))
    .filter((t) => t.text.length >= 2 && t.text.length <= 30 && !seen.has(t.text) && seen.add(t.text))
    .slice(0, 5)
}
