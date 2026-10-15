// main プロセスと文字起こし用プロセスの間でやりとりするメッセージ

export type AsrRequest =
  | { type: 'load'; modelDir: string; numThreads: number }
  | { type: 'transcribe'; id: number; samples: Float32Array }

export type AsrResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string }
