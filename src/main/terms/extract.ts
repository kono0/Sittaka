// 文字起こしの1発話から「知らない人が多そうな言葉」の候補を抜き出す。
// 形態素解析の結果に対する単純な規則で、取りこぼしより拾いすぎを優先する
// （どれを本当に調べるかは使う人が選び、後のステップで AI にも絞り込ませる）。
import joyo from 'joyo-kanji'

/** kuromoji の IpadicFeatures のうち使う分 */
export interface Token {
  surface_form: string
  pos: string
  pos_detail_1: string
  pos_detail_2: string
  word_type: string
  reading?: string
}

export type Reason = 'unknown' | 'rare-kanji' | 'compound' | 'katakana' | 'acronym' | 'organization'

export interface Term {
  text: string
  /** 漢字を含む言葉の読み（ひらがな）。変換ミスでも音から推測できるように付ける */
  reading?: string
  reasons: Reason[]
}

const JOYO = new Set(joyo.kanji)
const KANJI = /\p{Script=Han}/u
const KATAKANA_WORD = /^[\p{Script=Katakana}ー・]+$/u
const ALPHABET = /[A-Za-zＡ-Ｚａ-ｚ]{2,}/
const HIRAGANA_WORD = /^[\p{Script=Hiragana}ー]+$/u

// 名詞のつながりに入れる細分類。数・代名詞・非自立（「こと」「ため」など）・
// 副詞のようにも使う名詞（「全て」「今」「一番」など）は区切りにする。
const NOUN_PARTS = new Set(['一般', '固有名詞', 'サ変接続', '形容動詞語幹', '接尾', 'ナイ形容詞語幹'])
// 名詞だが、ほかの名詞とつなげると変な言葉になるもの（「全て自分」「一つ一つ理屈」など）
const BREAK_WORD = /^(自分|[一二三四五六七八九十幾何]+つ)$/
const LATIN = /[A-Za-zＡ-Ｚａ-ｚ]/
/** 漢字の言葉と英字の言葉が助詞なしで並んだら、別の言葉とみなす（「移動CPU」）。「プリントF」はつなぐ */
const scriptBreak = (a: string, b: string) =>
  (LATIN.test(a) && !LATIN.test(b) && KANJI.test(b)) || (LATIN.test(b) && !LATIN.test(a) && KANJI.test(a))

// カタカナでも、ほとんどの人が知っている言葉
const COMMON_KATAKANA = new Set(
  (
    'テレビ パソコン メール コーヒー スマホ ニュース インターネット ネット ゲーム ホテル レストラン ' +
    'ミーティング スケジュール プロジェクト チーム メンバー サービス システム データ ファイル ' +
    'ページ サイト アプリ ソフト パスワード アカウント ログイン メッセージ チャット オンライン ' +
    'イメージ ポイント タイミング スタート ストップ スタッフ リーダー ビジネス マネージャー ' +
    'カメラ マイク スピーカー イヤホン ボタン クリック コメント アイデア アイディア テーマ ' +
    'グループ カレンダー リスト メモ ノート ペン テスト ルール レベル スピード パターン'
  ).split(' ')
)

export function extractTerms(tokens: Token[]): Term[] {
  const terms: Term[] = []
  const seen = new Set<string>()
  for (const chunk of nounChunks(tokens)) {
    const term = judge(chunk)
    if (term && !seen.has(term.text)) {
      seen.add(term.text)
      terms.push(term)
    }
  }
  return terms
}

/**
 * 規則でふるいにかける前の、発話の中の名詞のまとまりをすべて返す（人名などは除く）。
 * AI を使うときは、こちらを候補として渡して AI に判断させる。
 */
export function extractNouns(tokens: Token[]): string[] {
  const nouns = nounChunks(tokens)
    .filter((c) => !c.some((t) => t.pos_detail_2 === '人名'))
    .map((c) => c.map((t) => t.surface_form).join(''))
    .filter((text) => text.length >= 2)
  return [...new Set(nouns)]
}

/** 連続する名詞（と頭につく接頭詞）を1つの言葉としてまとめる */
function nounChunks(tokens: Token[]): Token[][] {
  const chunks: Token[][] = []
  let cur: Token[] = []
  const flush = () => {
    // 末尾の接頭詞だけが残ったものは捨てる
    while (cur.length && cur[cur.length - 1].pos === '接頭詞') cur.pop()
    if (cur.length) chunks.push(cur)
    cur = []
  }
  for (const [i, t] of tokens.entries()) {
    // 「十分」「必要」などの形容動詞語幹は、「必要性」のように接尾辞が続くときだけ言葉の一部にする
    const adjStem = t.pos_detail_1 === '形容動詞語幹' && tokens[i + 1]?.pos_detail_1 !== '接尾'
    // ひらがなだけの名詞（「つまり」「もの」など）は、言葉の区切りとして扱う
    const plainKana = HIRAGANA_WORD.test(t.surface_form)
    const isNoun =
      t.pos === '名詞' && NOUN_PARTS.has(t.pos_detail_1) && !adjStem && !plainKana && !BREAK_WORD.test(t.surface_form)
    const isPrefix = t.pos === '接頭詞' && t.pos_detail_1 === '名詞接続'
    if (isNoun) {
      // 接尾辞（「性」「化」など）からは言葉を始めない
      if (cur.length === 0 && t.pos_detail_1 === '接尾') continue
      const prev = cur[cur.length - 1]
      if (prev && prev.pos !== '接頭詞' && scriptBreak(prev.surface_form, t.surface_form)) flush()
      cur.push(t)
    } else if (isPrefix) {
      if (cur.length) flush()
      cur.push(t)
    } else {
      flush()
    }
  }
  flush()
  return chunks
}

function judge(chunk: Token[]): Term | null {
  const text = chunk.map((t) => t.surface_form).join('')
  if (text.length < 2) return null
  // 人名（「田中さん」も含む）・地名はわざわざ調べる言葉ではない
  if (chunk.some((t) => t.pos_detail_2 === '人名')) return null
  if (chunk.length === 1 && chunk[0].pos_detail_2 === '地域') return null

  const reasons: Reason[] = []
  if (chunk.some((t) => t.word_type === 'UNKNOWN')) reasons.push('unknown')
  if ([...text].some((c) => KANJI.test(c) && !JOYO.has(c))) reasons.push('rare-kanji')
  if (ALPHABET.test(text)) reasons.push('acronym')
  if (KATAKANA_WORD.test(text) && text.length >= 4 && !COMMON_KATAKANA.has(text)) reasons.push('katakana')
  if (chunk.some((t) => t.pos_detail_2 === '組織')) reasons.push('organization')
  const contentParts = chunk.filter((t) => t.pos !== '接頭詞' && t.pos_detail_1 !== '副詞可能').length
  if (chunk.length >= 2 && contentParts >= 2 && text.length >= 3) reasons.push('compound')

  // 辞書に載っていないだけの、よく知られたカタカナ語（「スマホ」など）は対象外
  if (reasons.length === 1 && reasons[0] === 'unknown' && KATAKANA_WORD.test(text) && COMMON_KATAKANA.has(text)) {
    return null
  }
  if (reasons.length === 0) return null

  const term: Term = { text, reasons }
  const reading = readingOf(chunk)
  if (reading) term.reading = reading
  return term
}

/**
 * 漢字を含む言葉の読み（ひらがな）。辞書にない部分が混じると読みが分からないので、そのときは返さない
 */
export function readingOf(tokens: Token[]): string | undefined {
  const text = tokens.map((t) => t.surface_form).join('')
  if (!KANJI.test(text)) return undefined
  const readings = tokens.map((t) => (KANJI.test(t.surface_form) ? t.reading : t.surface_form))
  if (!readings.every((r) => r && r !== '*')) return undefined
  return toHiragana(readings.join(''))
}

function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}
