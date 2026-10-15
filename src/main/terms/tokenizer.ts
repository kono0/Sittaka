import { dirname, join } from 'node:path'
import kuromoji from 'kuromoji'
import type { Token } from './extract'

export interface Tokenizer {
  tokenize(text: string): Token[]
}

let building: Promise<Tokenizer> | null = null

/** kuromoji の辞書は読み込みに1秒ほどかかるので、一度だけ作って使い回す */
export function getTokenizer(): Promise<Tokenizer> {
  building ??= new Promise((resolve, reject) => {
    const dicPath = join(dirname(require.resolve('kuromoji/package.json')), 'dict')
    kuromoji.builder({ dicPath }).build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)))
  })
  return building
}
