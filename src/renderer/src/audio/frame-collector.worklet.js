// AudioWorklet: 128サンプルずつ届く音声を 100ms 分ためてメインスレッドに送る。
// AudioContext を 16kHz で作るので、ここに届く時点でリサンプル済み。
class FrameCollector extends AudioWorkletProcessor {
  constructor() {
    super()
    this.size = Math.round(sampleRate / 10)
    this.buf = new Float32Array(this.size)
    this.len = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    // ステレオならモノラルに混ぜる
    const n = input[0].length
    for (let i = 0; i < n; i++) {
      let v = 0
      for (let ch = 0; ch < input.length; ch++) v += input[ch][i]
      this.buf[this.len++] = v / input.length
      if (this.len === this.size) {
        this.port.postMessage(this.buf, [this.buf.buffer])
        this.buf = new Float32Array(this.size)
        this.len = 0
      }
    }
    return true
  }
}

registerProcessor('frame-collector', FrameCollector)
