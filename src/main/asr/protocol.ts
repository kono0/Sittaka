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
}

export type AsrRequest =
  | { type: 'load'; modelDir: string; numThreads: number }
  | { type: 'transcribe'; id: number; samples: Float32Array }

export type AsrResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; transcript: Transcript }
  | { type: 'error'; id?: number; message: string }
