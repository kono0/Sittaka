import { ipcMain } from 'electron'
import { extractNouns, extractTerms, type Term } from './extract'
import { getTokenizer } from './tokenizer'

export interface Extracted {
  /** 規則で選んだ言葉 */
  terms: Term[]
  /** ふるいにかける前の名詞のまとまりすべて（AI に渡す候補） */
  nouns: string[]
  /** 形態素解析の結果 */
  tokens: { surface: string; pos: string; known: boolean }[]
}

export function registerTermsIpc(): void {
  ipcMain.handle('terms:extract', async (_e, text: string): Promise<Extracted> => {
    const tokens = (await getTokenizer()).tokenize(text)
    return {
      terms: extractTerms(tokens),
      nouns: extractNouns(tokens),
      // 検証タブで、どう区切られたかを見せるため
      tokens: tokens.map((t) => ({
        surface: t.surface_form,
        pos: [t.pos, t.pos_detail_1, t.pos_detail_2].filter((p) => p && p !== '*').join('-'),
        known: t.word_type === 'KNOWN'
      }))
    }
  })
  // 辞書の読み込みに時間がかかるので、起動時に先に済ませておく
  void getTokenizer()
}
