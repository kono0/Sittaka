import { beforeAll, describe, expect, it } from 'vitest'
import { extractTerms } from './extract'
import { getTokenizer, type Tokenizer } from './tokenizer'

let tokenizer: Tokenizer
const terms = (s: string) => extractTerms(tokenizer.tokenize(s)).map((t) => t.text)

beforeAll(async () => {
  tokenizer = await getTokenizer()
})

describe('extractTerms', () => {
  it('picks jargon out of business and tech talk', () => {
    expect(terms('冪等性を担保するためにリトライ処理を入れておきました')).toEqual(['冪等性', 'リトライ処理'])
    expect(terms('じゃあ来週の会議でKPIとかROIの話をしましょう')).toEqual(['KPI', 'ROI'])
    expect(terms('このAPIはレイテンシがボトルネックになってるんですよね')).toEqual(['API', 'レイテンシ', 'ボトルネック'])
    expect(terms('デューデリジェンスの結果を見てからアサインを決めます')).toEqual(['デューデリジェンス', 'アサイン'])
    expect(terms('仕様の齟齬がないようにエビデンスを残してください')).toEqual(['齟齬', 'エビデンス'])
  })

  it('trims filler words and skips names', () => {
    expect(terms('それってつまり機会損失ってことですか')).toEqual(['機会損失'])
    expect(terms('この前の飲み会楽しかったよね田中さんも来てたし')).toEqual([])
    expect(terms('十分注意してください')).toEqual([])
  })

  it('ignores everyday conversation', () => {
    expect(terms('今日はいい天気ですね本当に')).toEqual([])
    expect(terms('明日のミーティングのスケジュールをメールで送ります')).toEqual([])
    expect(terms('そうですねそれでお願いします')).toEqual([])
  })

  it('adds a hiragana reading to words with kanji', () => {
    const [t] = extractTerms(tokenizer.tokenize('齟齬があります'))
    expect(t).toMatchObject({ text: '齟齬', reading: 'そご', reasons: ['rare-kanji'] })
  })

  it('does not repeat the same word within one utterance', () => {
    expect(terms('レイテンシとレイテンシの比較')).toEqual(['レイテンシ'])
  })
})
