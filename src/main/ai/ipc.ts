import { join } from 'node:path'
import { app, ipcMain, net } from 'electron'
import { getSarashinaKey, setSarashinaKey } from '../settings'
import { Wordbook, type WordbookEntry } from '../wordbook'
import { describeError, SarashinaClient, type ChatTrace } from './chat'
import { explainTerm } from './explain'
import { readingOf } from '../terms/extract'
import { getTokenizer } from '../terms/tokenizer'
import { LevelMemory, refineTerms, type Amount, type Judgment, type RefinedTerm } from './refine'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export type RefineResult =
  | { status: 'no-key' }
  | { status: 'busy'; waitMs: number }
  | { status: 'ok'; terms: RefinedTerm[]; judgments: Judgment[]; prompt: string; raw: string; ms: number }
  | { status: 'error'; error: string; prompt: string; raw: string; ms: number }

/**
 * AI と設定と単語帳の窓口。API キーは main プロセスの中だけで扱い、画面側には渡さない。
 */
export function registerAiIpc(): void {
  let client: SarashinaClient | null = null
  const getClient = () => {
    if (client) return client
    const key = getSarashinaKey()
    client = key ? new SarashinaClient(key, (url, init) => net.fetch(url, init)) : null
    return client
  }
  const levels = new LevelMemory()
  const wordbook = new Wordbook(join(app.getPath('userData'), 'wordbook.json'))

  ipcMain.handle('settings:get', () => ({ hasSarashinaKey: getSarashinaKey() !== null }))
  ipcMain.handle('settings:setSarashinaKey', async (_e, key: string | null) => {
    await setSarashinaKey(key?.trim() || null)
    client = null
  })

  /**
   * 結果には検証用に、AI に送った文と返ってきたそのままの文字列も付ける。
   * キーがない・混んでいるときは AI を通さない（画面側は規則の結果を使う）。
   */
  ipcMain.handle(
    'ai:refine',
    async (_e, context: string[], utterance: string, candidates: string[], amount: Amount): Promise<RefineResult> => {
      const c = getClient()
      if (!c) return { status: 'no-key' }
      // 1分60回の上限に近づいて待たされるなら、AI を通さない
      const waitMs = c.waitFor('sarashina3-nano')
      if (waitMs > 3000) return { status: 'busy', waitMs }
      const trace: ChatTrace & { prompt?: string } = {}
      try {
        const { terms, judgments } = await refineTerms(c, context, utterance, candidates, amount, trace, levels)
        return {
          status: 'ok',
          terms: await withDictionaryReadings(terms),
          judgments,
          prompt: trace.prompt ?? '',
          raw: trace.raw ?? '',
          ms: trace.ms ?? 0
        }
      } catch (err) {
        return {
          status: 'error',
          error: describeError(err),
          prompt: trace.prompt ?? '',
          raw: trace.raw ?? '',
          ms: trace.ms ?? 0
        }
      }
    }
  )

  ipcMain.handle('ai:explain', async (_e, context: string[], word: string) => {
    const c = getClient()
    if (!c) return { ok: false, error: '設定で Sarashina の API キーを入れると、意味を表示できます' }
    try {
      return { ok: true, value: await explainTerm(c, context, word) } satisfies Result<unknown>
    } catch (err) {
      return { ok: false, error: describeError(err) } satisfies Result<unknown>
    }
  })

  ipcMain.handle('wordbook:list', () => wordbook.list())
  ipcMain.handle('wordbook:save', (_e, entry: WordbookEntry) => wordbook.save(entry))
  ipcMain.handle('wordbook:remove', (_e, words: string[]) => wordbook.remove(words))
  ipcMain.handle('wordbook:move', (_e, words: string[], folder: string | null) => wordbook.move(words, folder))
  ipcMain.handle('wordbook:createFolder', (_e, name: string) => wordbook.createFolder(name))
  ipcMain.handle('wordbook:renameFolder', (_e, from: string, to: string) => wordbook.renameFolder(from, to))
  ipcMain.handle('wordbook:deleteFolder', (_e, name: string) => wordbook.deleteFolder(name))
}

/** 漢字の言葉は、AI の読みより辞書の読みを優先する（AI の読みは毎回ぶれるため） */
async function withDictionaryReadings(terms: RefinedTerm[]): Promise<RefinedTerm[]> {
  const tokenizer = await getTokenizer()
  return terms.map((t) => ({ ...t, reading: readingOf(tokenizer.tokenize(t.text)) ?? t.reading }))
}
