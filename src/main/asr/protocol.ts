// main プロセスと文字起こし用プロセスの間でやりとりするメッセージ

/** 文字起こしの1文字（またはひとかたまり）と、モデルがそれを選んだ確率（0〜1） */
export interface AsrToken {
  text: string
  p: number
}

export interface Transcript {
  text: string
  /** 聞き間違いを見分ける手がかり。出せないエンジンではなし */
  tokens?: AsrToken[]
  /** 認識のヒントとして渡せた言葉の数（ヒントを使っていないときはなし） */
  hints?: number
}

export type AsrRequest =
  | { type: 'load'; modelDir: string; numThreads: number; hints: boolean }
  | { type: 'transcribe'; id: number; samples: Float32Array; hints?: string[] }

export type AsrResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; transcript: Transcript }
  | { type: 'error'; id?: number; message: string }
