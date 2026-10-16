import { ApiError, type ChatClient, type Model } from './chat'

export interface Explanation {
  word: string
  reading: string
  meaning: string
}

const SCHEMA = {
  type: 'object',
  properties: {
    word: { type: 'string' },
    reading: { type: 'string' },
    meaning: { type: 'string' }
  },
  required: ['word', 'reading', 'meaning'],
  additionalProperties: false
}

const SYSTEM = `あなたは、通話中にこっそり言葉の意味を確かめたい人を助けるアシスタントです。
入力の会話は音声認識の結果なので、漢字の変換を間違えていることがあります。

やること:
- word: 会話の流れから見て正しい表記に直した言葉
- reading: 読み（ひらがな）
- meaning: この会話の中での意味を、一目で読める40字以内の一文で書く。辞書的な説明より「この場面で何を指しているか」を優先する。

推測で断定しすぎない。分からないときは一般的な意味を書く。`

/**
 * キープした言葉の意味を、会話に合わせて一文で説明させる。
 * 賢いほうのモデルを使い、混んでいたり上限に当たったりしたら速いほうに切り替える。
 */
export async function explainTerm(
  client: ChatClient & { waitFor?(model: Model): number },
  context: string[],
  word: string
): Promise<Explanation> {
  const messages = [
    { role: 'system' as const, content: SYSTEM },
    {
      role: 'user' as const,
      content: `会話:\n${context.length ? context.join('\n') : '（なし）'}\n\n調べたい言葉: ${word}`
    }
  ]
  // 賢いほうは回数の上限が低いことがある。待たされるくらいなら速いほうで早く返す
  const miniBusy = (client.waitFor?.('smart') ?? 0) > 2000
  const ask = (model: Model) => client.json<Explanation>(model, messages, SCHEMA, 300)
  let out: Explanation
  if (miniBusy) {
    out = await ask('fast')
  } else {
    try {
      out = await ask('smart')
    } catch (err) {
      if (!(err instanceof ApiError) || (err.status !== 429 && err.status < 500)) throw err
      out = await ask('fast')
    }
  }
  return {
    word: String(out.word ?? word).trim() || word,
    reading: String(out.reading ?? '').trim(),
    meaning: String(out.meaning ?? '').trim()
  }
}
