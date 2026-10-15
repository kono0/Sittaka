import { join } from 'node:path'
import { app, ipcMain, net } from 'electron'
import { getSarashinaKey, setSarashinaKey } from '../settings'
import { Wordbook, type WordbookEntry } from '../wordbook'
import { describeError, SarashinaClient } from './chat'
import { explainTerm } from './explain'
import { refineTerms } from './refine'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

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
  const wordbook = new Wordbook(join(app.getPath('userData'), 'wordbook.json'))

  ipcMain.handle('settings:get', () => ({ hasSarashinaKey: getSarashinaKey() !== null }))
  ipcMain.handle('settings:setSarashinaKey', async (_e, key: string | null) => {
    await setSarashinaKey(key?.trim() || null)
    client = null
  })

  ipcMain.handle('ai:refine', async (_e, context: string[], utterance: string, candidates: string[]) => {
    const c = getClient()
    if (!c) return null
    // 1分60回の上限に近づいて待たされるなら、AI を通さず規則の結果をそのまま使う
    if (c.waitFor('sarashina3-nano') > 3000) return null
    try {
      return await refineTerms(c, context, utterance, candidates)
    } catch (err) {
      console.warn('絞り込みに失敗しました:', describeError(err))
      return null
    }
  })

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
  ipcMain.handle('wordbook:remove', (_e, word: string) => wordbook.remove(word))
}
