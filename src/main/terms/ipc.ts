import { ipcMain } from 'electron'
import { extractNouns, extractTerms, type Term } from './extract'
import { getTokenizer } from './tokenizer'

export function registerTermsIpc(): void {
  ipcMain.handle('terms:extract', async (_e, text: string): Promise<{ terms: Term[]; nouns: string[] }> => {
    const tokens = (await getTokenizer()).tokenize(text)
    return { terms: extractTerms(tokens), nouns: extractNouns(tokens) }
  })
  // 辞書の読み込みに時間がかかるので、起動時に先に済ませておく
  void getTokenizer()
}
