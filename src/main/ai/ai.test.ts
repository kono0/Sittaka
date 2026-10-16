import { describe, expect, it } from 'vitest'
import { AiClient, ApiError, describeError, parseJson, type ChatClient, type ChatTrace, type Model } from './chat'
import { explainTerm } from './explain'
import { LevelMemory, refineTerms } from './refine'

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200 })
}

const clock = (t = { now: 0 }) => ({
  now: () => t.now,
  sleep: async (ms: number) => {
    t.now += ms
  }
})

describe('AiClient', () => {
  it('sends only documented fields to Sarashina and parses the JSON content', async () => {
    let sent: { url: string; init: RequestInit } | null = null
    const client = new AiClient('sarashina', 'k-123', async (url, init) => {
      sent = { url, init }
      return okResponse('```json\n{"terms":[]}\n```')
    })
    const trace: ChatTrace = {}
    expect(await client.json('fast', [{ role: 'user', content: 'hi' }], {}, 100, trace)).toEqual({ terms: [] })
    expect(trace.model).toBe('sarashina3-nano')
    expect(sent!.url).toBe('https://api.sarashina.ai/v1/chat/completions')
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe('Bearer k-123')
    const body = JSON.parse(sent!.init.body as string)
    expect(Object.keys(body).sort()).toEqual(
      ['max_completion_tokens', 'messages', 'model', 'response_format', 'temperature'].sort()
    )
  })

  it('uses the OpenAI-compatible endpoint for Gemini', async () => {
    let sent: { url: string; init: RequestInit } | null = null
    const client = new AiClient('gemini', 'g-1', async (url, init) => {
      sent = { url, init }
      return okResponse('{"a":1}')
    })
    expect(await client.json('smart', [{ role: 'user', content: 'hi' }], {}, 100)).toEqual({ a: 1 })
    expect(sent!.url).toContain('generativelanguage.googleapis.com')
    expect(JSON.parse(sent!.init.body as string).max_tokens).toBe(100)
  })

  it('asks Claude for the JSON as a forced tool call', async () => {
    let body: Record<string, unknown> = {}
    const client = new AiClient('claude', 'c-1', async (_url, init) => {
      body = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify({ content: [{ type: 'tool_use', name: 'result', input: { word: '稟議' } }] }),
        { status: 200 }
      )
    })
    const out = await client.json(
      'fast',
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' }
      ],
      { type: 'object' },
      50
    )
    expect(out).toEqual({ word: '稟議' })
    expect(body.system).toBe('sys')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'result' })
  })

  it('spaces out calls to stay under the per-minute limit', async () => {
    const waits: number[] = []
    const t = { now: 0 }
    const c = clock(t)
    const client = new AiClient('sarashina', 'k', async () => okResponse('{}'), {
      now: c.now,
      sleep: async (ms) => {
        waits.push(ms)
        await c.sleep(ms)
      }
    })
    await client.json('smart', [], {}, 10)
    await client.json('smart', [], {}, 10)
    await client.json('fast', [], {}, 10)
    // Sarashina の mini は1分6回 → 10秒おき。nano は別枠
    expect(waits).toEqual([10000])
    expect(client.waitFor('smart')).toBe(10000)
  })

  it('turns API errors into readable messages', async () => {
    const client = new AiClient(
      'sarashina',
      'bad',
      async () => new Response('{"message":"unauthorized"}', { status: 401 })
    )
    const err = await client.json('fast', [], {}, 10).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(describeError(err)).toBe('API キーが正しくないようです')
    const gemini = new AiClient(
      'gemini',
      'g',
      async () => new Response('[{"error":{"message":"boom"}}]', { status: 500 })
    )
    expect(describeError(await gemini.json('fast', [], {}, 10).catch((e) => e))).toBe(
      'Gemini でエラーが起きました（boom）'
    )
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
  const item = (candidate: string, level: number, text = candidate, reading = '') => ({
    candidate,
    text,
    reading,
    level
  })

  it('keeps candidates at or above the level for the chosen amount', async () => {
    const client = fakeClient(() => ({
      candidates: [item('文字', 1), item('実行', 2), item('変数', 3, '変数', 'へんすう'), item('冪等性', 4)],
      added: []
    }))
    const pick = async (amount: 'few' | 'normal' | 'many') =>
      (await refineTerms(client, [], 'x', [], amount)).terms.map((t) => t.text)
    expect(await pick('few')).toEqual(['冪等性'])
    expect(await pick('normal')).toEqual(['変数', '冪等性'])
    expect(await pick('many')).toEqual(['実行', '変数', '冪等性'])
  })

  it('records every judgment, fixes and additions, and cleans the output', async () => {
    const client = fakeClient(() => ({
      candidates: [
        item(' 返信 ', 3, '変数', 'へんすう'),
        item('変数', 3),
        item('アルファベット', 3, 'アルファベット', 'あlphabet'),
        item('a', 4),
        item('数', 9)
      ],
      added: [item('代入', 3, '代入', 'だいにゅう'), item('A1', 4), item('B1', 4), item('C1', 4)]
    }))
    const out = await refineTerms(client, [], 'x', ['返信', '変数', 'アルファベット', 'a', '数'])
    expect(out.terms).toEqual([
      { text: '変数', reading: 'へんすう' },
      { text: 'アルファベット', reading: '' },
      { text: '代入', reading: 'だいにゅう' },
      { text: 'A1', reading: '' },
      { text: 'B1', reading: '' }
    ])
    expect(out.judgments[0]).toEqual({ candidate: '返信', text: '変数', level: 3, added: false, kept: true })
    // 直した結果と重なった候補は二重に並べない
    expect(out.judgments[1].kept).toBe(false)
    // 段階は 1〜4 に収める
    expect(out.judgments[4].level).toBe(4)
    expect(out.judgments.filter((j) => j.added)).toHaveLength(3)
  })

  it('turns katakana readings into hiragana', async () => {
    const client = fakeClient(() => ({ candidates: [item('CPU', 3, 'CPU', 'シーピーユー')], added: [] }))
    expect((await refineTerms(client, [], 'x', ['CPU'])).terms).toEqual([{ text: 'CPU', reading: 'しーぴーゆー' }])
  })

  it('settles each word on its most common level so it stays steady', async () => {
    let level = 3
    const client = fakeClient(() => ({ candidates: [item('プログラム', level)], added: [] }))
    const memory = new LevelMemory()
    const run = async () =>
      (await refineTerms(client, [], 'x', ['プログラム'], 'normal', undefined, memory)).judgments[0]
    expect((await run()).kept).toBe(true)
    level = 1
    // 1回ずつなら先に付いた段階のまま
    expect(await run()).toMatchObject({ level: 3, kept: true })
    expect(await run()).toMatchObject({ level: 1, kept: false })
  })

  it('splits words the AI separates and passes earlier words as hints', async () => {
    const prompts: string[] = []
    const client: Parameters<typeof refineTerms>[0] = {
      json: async <T>(_m: unknown, messages: { content: string }[]) => {
        prompts.push(messages[1].content)
        return { candidates: [item('ディオゲネス古代ギリシャ', 4, 'ディオゲネス、古代ギリシャ', 'x')], added: [] } as T
      }
    } as never
    const memory = new LevelMemory()
    const out = await refineTerms(client, [], 'x', ['ディオゲネス古代ギリシャ'], 'normal', undefined, memory)
    expect(out.terms).toEqual([
      { text: 'ディオゲネス', reading: '' },
      { text: '古代ギリシャ', reading: '' }
    ])
    await refineTerms(client, [], 'x', [], 'normal', undefined, memory)
    expect(prompts[1]).toContain('これまでに出た言葉: 古代ギリシャ、ディオゲネス')
  })
})

describe('explainTerm', () => {
  it('falls back to the fast model when the smart one hits the rate limit', async () => {
    const log: Model[] = []
    const client = fakeClient(
      (m) =>
        m === 'smart'
          ? new ApiError(429, 'too many')
          : { word: '稟議', reading: 'りんぎ', meaning: '社内で決裁を回して承認をもらうこと' },
      log
    )
    const out = await explainTerm(client, ['相手: 社内で稟議を回します'], '稟議')
    expect(log).toEqual(['smart', 'fast'])
    expect(out.meaning).toContain('承認')
  })

  it('does not retry on a bad key', async () => {
    const client = fakeClient(() => new ApiError(401, 'unauthorized'))
    await expect(explainTerm(client, [], '稟議')).rejects.toBeInstanceOf(ApiError)
  })
})
