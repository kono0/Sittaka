// 言葉の絞り込みと意味の説明に使う AI の呼び出し口。利用者が選んだ会社の API に、自分のキーで送る。
// どの会社でも「速くて安いモデル（fast）」と「少し賢いモデル（smart）」の2段で使い分ける。

export type Model = 'fast' | 'smart'

export type ProviderId = 'sarashina' | 'gemini' | 'claude'

export interface ProviderInfo {
  id: ProviderId
  label: string
  models: Record<Model, string>
  /** 1分あたりに送ってよい回数。超えると 429 が返る */
  rpm: Record<Model, number>
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  sarashina: {
    id: 'sarashina',
    label: 'Sarashina',
    models: { fast: 'sarashina3-nano', smart: 'sarashina3-mini' },
    // 無料ベータの上限
    rpm: { fast: 60, smart: 6 }
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    // 「latest」は Google 側で最新の版に差し替わる別名。lite は考える時間を使わないので速い
    models: { fast: 'gemini-flash-lite-latest', smart: 'gemini-flash-lite-latest' },
    rpm: { fast: 15, smart: 15 }
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    models: { fast: 'claude-haiku-5-5', smart: 'claude-haiku-5-5' },
    rpm: { fast: 50, smart: 50 }
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 検証用に、AI とのやりとりの中身を残す入れ物 */
export interface ChatTrace {
  /** 実際に使ったモデルの名前 */
  model?: string
  /** AI が返したそのままの文字列 */
  raw?: string
  /** 返事が来るまでの時間（間隔待ちは含まない） */
  ms?: number
}

export interface ChatClient {
  /** JSON Schema に沿った JSON を返させて、パース済みの値を返す */
  json<T>(model: Model, messages: ChatMessage[], schema: object, maxTokens: number, trace?: ChatTrace): Promise<T>
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly provider = 'AI'
  ) {
    super(message)
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>
type Clock = { now: () => number; sleep: (ms: number) => Promise<void> }

const realClock: Clock = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }

/** 会社ごとの送り方の違い（宛先・書式・返事の取り出し方） */
interface Wire {
  url: string
  headers: Record<string, string>
  body(model: string, messages: ChatMessage[], schema: object, maxTokens: number): object
  content(body: unknown): string
  error(body: unknown): string | undefined
}

function openAiWire(url: string, apiKey: string, tokensField: string): Wire {
  return {
    url,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: (model, messages, schema, maxTokens) => ({
      model,
      messages,
      temperature: 0.2,
      [tokensField]: maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } }
    }),
    content: (b) =>
      (b as { choices?: { message?: { content?: string | null } }[] }).choices?.[0]?.message?.content ?? '',
    error: (b) => {
      const e = b as { message?: string; error?: { message?: string } } | { error?: { message?: string } }[]
      return Array.isArray(e) ? e[0]?.error?.message : (e.message ?? e.error?.message)
    }
  }
}

/** Claude はツールの引数として JSON を返させると、形がスキーマどおりになる */
function claudeWire(apiKey: string): Wire {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: (model, messages, schema, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      system: messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n'),
      messages: messages.filter((m) => m.role !== 'system'),
      tools: [{ name: 'result', description: '結果を返す', input_schema: schema }],
      tool_choice: { type: 'tool', name: 'result' }
    }),
    content: (b) => {
      const block = (b as { content?: { type: string; input?: unknown; text?: string }[] }).content?.find(
        (c) => c.type === 'tool_use'
      )
      return block ? JSON.stringify(block.input) : ''
    },
    error: (b) => (b as { error?: { message?: string } }).error?.message
  }
}

function wireFor(provider: ProviderId, apiKey: string): Wire {
  switch (provider) {
    case 'sarashina':
      // OpenAI と似ているが、未対応の項目を送ると 400 になるので、ドキュメントにある項目だけを使う
      return openAiWire('https://api.sarashina.ai/v1/chat/completions', apiKey, 'max_completion_tokens')
    case 'gemini':
      return openAiWire(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        apiKey,
        'max_tokens'
      )
    case 'claude':
      return claudeWire(apiKey)
  }
}

export class AiClient implements ChatClient {
  private readonly info: ProviderInfo
  private readonly wire: Wire
  private nextSlot: Record<Model, number> = { fast: 0, smart: 0 }

  constructor(
    provider: ProviderId,
    apiKey: string,
    private readonly fetchImpl: Fetch,
    private readonly clock: Clock = realClock
  ) {
    this.info = PROVIDERS[provider]
    this.wire = wireFor(provider, apiKey)
  }

  /** いま送ると何ミリ秒待たされるか（混んでいたら呼び出し側で諦める判断に使う） */
  waitFor(model: Model): number {
    return Math.max(0, this.nextSlot[model] - this.clock.now())
  }

  async json<T>(
    model: Model,
    messages: ChatMessage[],
    schema: object,
    maxTokens: number,
    trace: ChatTrace = {}
  ): Promise<T> {
    // 上限を超えないよう、モデルごとに呼び出しの間隔をあける
    const { now, sleep } = this.clock
    const interval = 60000 / this.info.rpm[model]
    const slot = Math.max(now(), this.nextSlot[model])
    this.nextSlot[model] = slot + interval
    if (slot > now()) await sleep(slot - now())

    const name = this.info.models[model]
    trace.model = name
    const started = now()
    const res = await this.fetchImpl(this.wire.url, {
      method: 'POST',
      headers: this.wire.headers,
      body: JSON.stringify(this.wire.body(name, messages, schema, maxTokens))
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      trace.raw = text
      trace.ms = now() - started
      let message = `HTTP ${res.status}`
      try {
        message = this.wire.error(JSON.parse(text)) ?? message
      } catch {
        // 本文がなくてもステータスで分かる
      }
      throw new ApiError(res.status, message, this.info.label)
    }
    trace.raw = this.wire.content(await res.json())
    trace.ms = now() - started
    return parseJson<T>(trace.raw)
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
    return `${err.provider} でエラーが起きました（${err.message}）`
  }
  return err instanceof Error ? err.message : String(err)
}
