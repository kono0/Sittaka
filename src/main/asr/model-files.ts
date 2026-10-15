// ReazonSpeech k2 v2（日本語専用の音声認識モデル）の int8 版。
export const MODEL_ID = 'reazonspeech-k2-v2-int8'

export const MODEL_FILES = {
  encoder: 'encoder-epoch-99-avg-1.int8.onnx',
  decoder: 'decoder-epoch-99-avg-1.int8.onnx',
  joiner: 'joiner-epoch-99-avg-1.int8.onnx',
  tokens: 'tokens.txt'
} as const

// sherpa-onnx が配布しているアーカイブ。fp32 版も入っていて大きい（約700MB）ので、
// 公開版では int8 の4ファイルだけを別に配布する予定。
export const MODEL_ARCHIVE_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01.tar.bz2'
export const MODEL_ARCHIVE_ROOT = 'sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01'
