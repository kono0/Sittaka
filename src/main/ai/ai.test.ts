import { describe, expect, it } from 'vitest'
import { ApiError, describeError, parseJson, SarashinaClient, type ChatClient, type Model } from './chat'
import { explainTerm } from './explain'
import { refineTerms } from './refine'

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200 })
}

describe('SarashinaClient', () => {
  it('sends only documented fields and parses the JSON content', async () => {
    let sent: { url: string; init: RequestInit } | null = null
    const client = new SarashinaClient('k-123', async (url, init) => {
      sent = { url, init }
      return okResponse('```json\n{"terms":[]}\n```')
    })
    expect(await client.json('sarashina3-nano', [{ role: 'user', content: 'hi' }], {}, 100)).toEqual({ terms: [] })
    expect(sent!.url).toBe('https://api.sarashina.ai/v1/chat/completions')
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe('Bearer k-123')
    const body = JSON.parse(sent!.init.body as string)
    expect(Object.keys(body).sort()).toEqual(
      ['max_completion_tokens', 'messages', 'model', 'response_format', 'temperature'].sort()
    )
  })

  it('spaces out calls to stay under the per-minute limit', async () => {
    let t = 0
    const waits: number[] = []
    const client = new SarashinaClient(
      'k',
      async () => okResponse('{}'),
      () => t,
      async (ms) => {
        waits.push(ms)
        t += ms
      }
    )
    await client.json('sarashina3-mini', [], {}, 10)
    await client.json('sarashina3-mini', [], {}, 10)
    await client.json('sarashina3-nano', [], {}, 10)
    // mini は1分6回 → 10秒おき。nano は別枠
    expect(waits).toEqual([10000])
    expect(client.waitFor('sarashina3-mini')).toBe(10000)
  })

  it('turns API errors into readable messages', async () => {
    const client = new SarashinaClient('bad', async () => new Response('{"message":"unauthorized"}', { status: 401 }))
    const err = await client.json('sarashina3-nano', [], {}, 10).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(describeError(err)).toBe('API キーが正しくないようです')
  })

  it('parses bare JSON too', () => {
    expect(parseJson('  {"a":1} ')).toEqual({ a: 1 })
  })
})

function fakeClient(reply: (model: Model) => unknown, log: Model[] = []): ChatClient {
  return {
    json: async <T>(model: Model) => {
      log.push(model)
      const r = reply(model)
      if (r instanceof Error) throw r
      return r as T
    }
  }
}

describe('refineTerms', () => {
  it('cleans, dedupes and caps the model output', async () => {
    const client = fakeClient(() => ({
      terms: [
        { text: ' 冪等性 ', reading: 'べきとうせい' },
        { text: '冪等性', reading: 'べきとうせい' },
        { text: 'a', reading: 'えー' },
        ...['A1', 'B1', 'C1', 'D1', 'E1'].map((text) => ({ text, reading: '' }))
      ]
    }))
    const out = await refineTerms(client, [], '冪等性を担保します', ['冪等性'])
    expect(out.map((t) => t.text)).toEqual(['冪等性', 'A1', 'B1', 'C1', 'D1'])
  })
})

describe('explainTerm', () => {
  it('falls back to nano when mini hits the rate limit', async () => {
    const log: Model[] = []
    const client = fakeClient(
      (m) =>
        m === 'sarashina3-mini'
          ? new ApiError(429, 'too many')
          : { word: '稟議', reading: 'りんぎ', meaning: '社内で決裁を回して承認をもらうこと' },
      log
    )
    const out = await explainTerm(client, ['相手: 社内で稟議を回します'], '稟議')
    expect(log).toEqual(['sarashina3-mini', 'sarashina3-nano'])
    expect(out.meaning).toContain('承認')
  })

  it('does not retry on a bad key', async () => {
    const client = fakeClient(() => new ApiError(401, 'unauthorized'))
    await expect(explainTerm(client, [], '稟議')).rejects.toBeInstanceOf(ApiError)
  })
})
