import type { Extracted, RefineResult } from '../../../preload/api'
import type { Speaker } from '../audio/capture'

/** 1つの発言が、文字起こしから最終的な言葉になるまでの記録（検証タブ用） */
export interface Trace {
  id: number
  at: string
  source: 'call' | 'manual'
  speaker: Speaker
  text: string
  /** 文字起こしの遅れと処理時間（手入力のときはなし） */
  asr?: { latencyMs: number; inferenceMs: number; audioMs: number }
  extracted?: Extracted
  ai?: RefineResult
  /** 最終的に「聞こえた言葉」に並べた言葉 */
  final: string[]
  /** どちらの結果を使ったか */
  decidedBy: 'ai' | 'rules'
  error?: string
}

export interface Comparison {
  /** AI が候補の中から残した言葉 */
  kept: string[]
  /** AI が外した候補 */
  dropped: string[]
  /** 候補になかったのに AI が足した言葉（漢字を直したものもここに入る） */
  added: string[]
}

/** 名詞の候補と AI の答えを突き合わせる */
export function compare(nouns: string[], aiTerms: string[]): Comparison {
  const ai = new Set(aiTerms)
  const candidates = new Set(nouns)
  return {
    kept: nouns.filter((n) => ai.has(n)),
    dropped: nouns.filter((n) => !ai.has(n)),
    added: aiTerms.filter((t) => !candidates.has(t))
  }
}

export interface Totals {
  utterances: number
  nouns: number
  ruleHits: number
  aiCalls: number
  aiKept: number
  aiAdded: number
  aiErrors: number
  aiSkipped: number
  aiAvgMs: number | null
  final: number
}

export function totals(traces: Trace[]): Totals {
  let nouns = 0
  let ruleHits = 0
  let aiCalls = 0
  let aiKept = 0
  let aiAdded = 0
  let aiErrors = 0
  let aiSkipped = 0
  let aiMs = 0
  let final = 0
  for (const t of traces) {
    nouns += t.extracted?.nouns.length ?? 0
    ruleHits += t.extracted?.terms.length ?? 0
    final += t.final.length
    const ai = t.ai
    if (!ai || ai.status === 'no-key' || ai.status === 'busy') {
      if (ai) aiSkipped++
      continue
    }
    aiCalls++
    aiMs += ai.ms
    if (ai.status === 'error') {
      aiErrors++
      continue
    }
    const c = compare(
      t.extracted?.nouns ?? [],
      ai.terms.map((x) => x.text)
    )
    aiKept += c.kept.length
    aiAdded += c.added.length
  }
  return {
    utterances: traces.length,
    nouns,
    ruleHits,
    aiCalls,
    aiKept,
    aiAdded,
    aiErrors,
    aiSkipped,
    aiAvgMs: aiCalls ? aiMs / aiCalls : null,
    final
  }
}
