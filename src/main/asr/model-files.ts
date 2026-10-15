// ReazonSpeech k2 v2（日本語専用の音声認識モデル）の int8 版。
export const MODEL_ID = 'reazonspeech-k2-v2-int8'

export const MODEL_FILES = {
  encoder: 'encoder-epoch-99-avg-1.int8.onnx',
  decoder: 'decoder-epoch-99-avg-1.int8.onnx',
  joiner: 'joiner-epoch-99-avg-1.int8.onnx',
  tokens: 'tokens.txt'
} as const

// 配布元（Hugging Face）から int8 の4ファイルだけを個別に取る（合計 約160MB）
export const MODEL_FILE_BASE_URL = 'https://huggingface.co/reazon-research/reazonspeech-k2-v2/resolve/main'

// 個別に取れなかったときの予備。sherpa-onnx のアーカイブで、使わない fp32 版も入っていて約700MBある。
export const MODEL_ARCHIVE_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01.tar.bz2'
export const MODEL_ARCHIVE_ROOT = 'sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01'
