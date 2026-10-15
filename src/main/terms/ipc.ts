import { ipcMain } from 'electron'
import { extractTerms, type Term } from './extract'
import { getTokenizer } from './tokenizer'

export function registerTermsIpc(): void {
  ipcMain.handle('terms:extract', async (_e, text: string): Promise<Term[]> => {
    const tokenizer = await getTokenizer()
    return extractTerms(tokenizer.tokenize(text))
  })
  // 辞書の読み込みに時間がかかるので、起動時に先に済ませておく
  void getTokenizer()
}
