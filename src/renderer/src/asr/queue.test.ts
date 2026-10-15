import { describe, expect, it } from 'vitest'
import type { Transcriber } from './transcriber'
import { TranscriptionQueue, type TranscriptLine } from './queue'

function fakeEngine(results: Record<number, string>, log: number[]): Transcriber {
  return {
    label: 'fake',
    load: async () => {},
    dispose: () => {},
    transcribe: async (audio) => {
      log.push(audio.length)
      await new Promise((r) => setTimeout(r, 5))
      const text = results[audio.length]
      if (text === 'ERR') throw new Error('boom')
      return text
    }
  }
}

const tick = () => new Promise((r) => setTimeout(r, 50))

describe('TranscriptionQueue', () => {
  it('transcribes jobs one at a time in arrival order', async () => {
    const log: number[] = []
    const lines: TranscriptLine[] = []
    const q = new TranscriptionQueue(fakeEngine({ 16000: 'こんにちは', 32000: 'はい' }, log), (l) => lines.push(l), () => {})
    q.push('other', new Float32Array(16000), 0)
    q.push('self', new Float32Array(32000), 0)
    expect(q.backlog).toBe(1)
    await tick()
    expect(log).toEqual([16000, 32000])
    expect(lines.map((l) => [l.speaker, l.text])).toEqual([
      ['other', 'こんにちは'],
      ['self', 'はい']
    ])
    expect(lines[1].audioMs).toBe(2000)
  })

  it('skips empty text and keeps going after an error', async () => {
    const lines: TranscriptLine[] = []
    const errors: Error[] = []
    const q = new TranscriptionQueue(
      fakeEngine({ 100: '', 200: 'ERR', 300: 'ok' }, []),
      (l) => lines.push(l),
      (e) => errors.push(e)
    )
    q.push('other', new Float32Array(100), 0)
    q.push('other', new Float32Array(200), 0)
    q.push('other', new Float32Array(300), 0)
    await tick()
    expect(lines.map((l) => l.text)).toEqual(['ok'])
    expect(errors).toHaveLength(1)
  })
})
