// Sarashina の Chat Completions API を呼ぶ。OpenAI と似ているが、未対応の項目を送ると 400 になるので
// ドキュメントにある項目だけを使う（max_tokens ではなく max_completion_tokens など）。

export type Model = 'sarashina3-mini' | 'sarashina3-nano'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatClient {
  /** JSON Schema に沿った JSON を返させて、パース済みの値を返す */
  json<T>(model: Model, messages: ChatMessage[], schema: object, maxTokens: number): Promise<T>
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** 1分あたりの上限（無料ベータ）。超えると 429 が返り、待つべき時間は教えてくれない */
const RPM: Record<Model, number> = { 'sarashina3-mini': 6, 'sarashina3-nano': 60 }

export class SarashinaClient implements ChatClient {
  private nextSlot: Record<Model, number> = { 'sarashina3-mini': 0, 'sarashina3-nano': 0 }

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  /** いま送ると何ミリ秒待たされるか（混んでいたら呼び出し側で諦める判断に使う） */
  waitFor(model: Model): number {
    return Math.max(0, this.nextSlot[model] - this.now())
  }

  async json<T>(model: Model, messages: ChatMessage[], schema: object, maxTokens: number): Promise<T> {
    // 上限を超えないよう、モデルごとに呼び出しの間隔をあける
    const interval = 60000 / RPM[model]
    const slot = Math.max(this.now(), this.nextSlot[model])
    this.nextSlot[model] = slot + interval
    if (slot > this.now()) await this.sleep(slot - this.now())

    const res = await this.fetchImpl('https://api.sarashina.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_completion_tokens: maxTokens,
        response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } }
      })
    })
    if (!res.ok) {
      let message = `HTTP ${res.status}`
      try {
        message = ((await res.json()) as { message?: string }).message ?? message
      } catch {
        // 本文がなくてもステータスで分かる
      }
      throw new ApiError(res.status, message)
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] }
    return parseJson<T>(body.choices?.[0]?.message?.content ?? '')
  }
}

/** スキーマ指定でも ```json で囲んで返すことがあるので、外して読む */
export function parseJson<T>(text: string): T {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  return JSON.parse(trimmed) as T
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return 'API キーが正しくないようです'
    if (err.status === 429) return '短い時間に使いすぎました。少し待ってからもう一度押してください'
    return `Sarashina でエラーが起きました（${err.message}）`
  }
  return err instanceof Error ? err.message : String(err)
}
