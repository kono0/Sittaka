import { describe, expect, it } from 'vitest'
import { compare, totals, wordConfidence, type Trace } from './trace'

const base = { at: '', source: 'call' as const, speaker: 'other' as const, decidedBy: 'ai' as const }

describe('compare', () => {
  it('splits candidates into kept and dropped, and finds additions', () => {
    expect(compare(['変数', '関数', '今日'], ['変数', '関数', 'スコープ'])).toEqual({
      kept: ['変数', '関数'],
      dropped: ['今日'],
      added: ['スコープ']
    })
  })
})

describe('totals', () => {
  it('adds up each stage across utterances', () => {
    const traces: Trace[] = [
      {
        ...base,
        id: 1,
        text: 'a',
        extracted: { terms: [{ text: '関数', reasons: [] }], nouns: ['変数', '関数', '今日'], tokens: [] },
        ai: {
          status: 'ok',
          judgments: [],
          terms: [
            { text: '変数', reading: '' },
            { text: 'スコープ', reading: '' }
          ],
          prompt: '',
          raw: '',
          ms: 400
        },
        final: ['変数', 'スコープ']
      },
      {
        ...base,
        id: 2,
        text: 'b',
        extracted: { terms: [], nouns: ['会議'], tokens: [] },
        ai: { status: 'error', error: 'x', prompt: '', raw: '', ms: 200 },
        final: [],
        decidedBy: 'rules'
      },
      { ...base, id: 3, text: 'c', ai: { status: 'busy', waitMs: 5000 }, final: [], decidedBy: 'rules' }
    ]
    expect(totals(traces)).toEqual({
      utterances: 3,
      nouns: 4,
      ruleHits: 1,
      aiCalls: 2,
      aiKept: 1,
      aiAdded: 1,
      aiErrors: 1,
      aiSkipped: 1,
      aiAvgMs: 300,
      final: 2
    })
  })
})

describe('wordConfidence', () => {
  const tokens = [..."次はJDPです"].map((text, i) => ({ text, p: [0.9, 0.9, 0.3, 0.8, 0.7, 1, 1][i] }))

  it('returns the lowest probability inside the word', () => {
    expect(wordConfidence(tokens, 'JDP')).toBe(0.3)
    expect(wordConfidence(tokens, 'です')).toBe(1)
  })

  it('handles multi-character tokens and missing words', () => {
    expect(wordConfidence([{ text: 'GDP', p: 0.4 }, { text: 'は', p: 1 }], 'DP')).toBe(0.4)
    expect(wordConfidence(tokens, 'GDP')).toBeNull()
    expect(wordConfidence(undefined, 'JDP')).toBeNull()
  })
})
