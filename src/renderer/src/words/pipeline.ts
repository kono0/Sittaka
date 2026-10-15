import type { Speaker } from '../audio/capture'
import type { Trace } from '../inspect/trace'

export type Amount = 'few' | 'normal' | 'many'

let nextId = 1

/**
 * 1つの発言から「聞こえた言葉」に並べる言葉を決める。途中経過はすべて Trace に残す。
 * キーがあれば、規則でふるう前の名詞をすべて AI に見せて選ばせる。
 * キーがない・混んでいる・失敗したときは規則の結果を使う。
 */
export async function findTerms(
  text: string,
  speaker: Speaker,
  context: string[],
  amount: Amount,
  source: Trace['source'] = 'call'
): Promise<{ trace: Trace; terms: { text: string; reading?: string }[] }> {
  const trace: Trace = {
    id: nextId++,
    at: new Date().toISOString(),
    source,
    speaker,
    text,
    final: [],
    decidedBy: 'rules'
  }
  try {
    const extracted = await window.terms.extract(text)
    trace.extracted = extracted
    if (extracted.nouns.length > 0) {
      trace.ai = await window.ai.refine(context, text, extracted.nouns, amount)
    }
    const terms = trace.ai?.status === 'ok' ? trace.ai.terms : extracted.terms
    trace.decidedBy = trace.ai?.status === 'ok' ? 'ai' : 'rules'
    trace.final = terms.map((t) => t.text)
    return { trace, terms }
  } catch (err) {
    trace.error = err instanceof Error ? err.message : String(err)
    return { trace, terms: [] }
  }
}
