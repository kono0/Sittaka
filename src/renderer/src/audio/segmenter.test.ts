import { describe, expect, it } from 'vitest'
import { Segmenter, type Segment } from './segmenter'

const SR = 16000
const FRAME = 1600 // 100ms

function tone(ms: number, amp = 0.2): Float32Array[] {
  const frames: Float32Array[] = []
  for (let t = 0; t < ms; t += 100) {
    const f = new Float32Array(FRAME)
    for (let i = 0; i < FRAME; i++) f[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR)
    frames.push(f)
  }
  return frames
}

function silence(ms: number, amp = 0.001): Float32Array[] {
  return tone(ms, amp)
}

function run(seg: Segmenter, frames: Float32Array[]): Segment[] {
  return frames.flatMap((f) => seg.push(f))
}

describe('Segmenter', () => {
  it('emits one segment per utterance after trailing silence', () => {
    const seg = new Segmenter()
    const out = run(seg, [...silence(1000), ...tone(1000), ...silence(1000), ...tone(800), ...silence(1000)])
    expect(out).toHaveLength(2)
    // 発話 + 前の余白 + 終端判定までの無音
    expect(out[0].durationMs).toBeGreaterThanOrEqual(1000)
    expect(out[0].durationMs).toBeLessThanOrEqual(1800)
  })

  it('drops blips shorter than minSpeechMs', () => {
    const seg = new Segmenter()
    expect(run(seg, [...silence(1000), ...tone(100), ...silence(1000)])).toHaveLength(0)
  })

  it('splits long speech at maxSegmentMs', () => {
    const seg = new Segmenter({ maxSegmentMs: 3000 })
    // 実際の会話のように、息継ぎ程度の短い切れ目を挟みながら7秒話し続ける
    const talking = Array.from({ length: 7 }, () => [...tone(800), ...silence(200)]).flat()
    const out = run(seg, [...silence(500), ...talking, ...silence(1000)])
    expect(out.length).toBe(3)
    for (const s of out) expect(s.durationMs).toBeLessThanOrEqual(3000)
  })

  it('flushes pending speech on end()', () => {
    const seg = new Segmenter()
    run(seg, [...silence(500), ...tone(1000)])
    expect(seg.end()?.durationMs).toBeGreaterThanOrEqual(1000)
    expect(seg.end()).toBeNull()
  })

  it('adapts to a steady noise floor', () => {
    const seg = new Segmenter()
    // 鳴りっぱなしの空調音のようなノイズ（minThreshold より大きい）
    const hum = () => silence(100, 0.03)[0]
    const warmup = Array.from({ length: 100 }, hum)
    run(seg, warmup)
    // 慣れた後はノイズだけでは区切られない
    expect(run(seg, Array.from({ length: 100 }, hum))).toHaveLength(0)
    // ノイズの上で話した声はちゃんと拾う
    const loud = tone(1000, 0.3)
    const out = run(seg, [...loud, ...Array.from({ length: 10 }, hum)])
    expect(out).toHaveLength(1)
  })
})
