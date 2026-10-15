import { describe, expect, it } from 'vitest'
import { WordBoard } from './board'

const texts = (ws: { text: string }[]) => ws.map((w) => w.text)

describe('WordBoard', () => {
  it('lists words newest first and bumps repeats to the top', () => {
    const b = new WordBoard()
    b.add([{ text: 'API' }, { text: '冪等性' }], 'other', 1)
    b.add([{ text: '稟議' }], 'self', 2)
    b.add([{ text: 'API' }], 'other', 3)
    expect(texts(b.recent())).toEqual(['API', '稟議', '冪等性'])
    expect(b.recent()[0].count).toBe(2)
  })

  it('moves kept words out of the stream and back again', () => {
    const b = new WordBoard()
    b.add([{ text: 'A1' }, { text: 'B1' }, { text: 'C1' }], 'other', 1)
    b.keep('C1', 5)
    b.keep('A1', 6)
    expect(texts(b.kept())).toEqual(['C1', 'A1'])
    expect(texts(b.recent())).toEqual(['B1'])
    b.unkeep('C1')
    expect(texts(b.kept())).toEqual(['A1'])
    expect(texts(b.recent())).toContain('C1')
  })

  it('drops the oldest unkept words but never kept ones', () => {
    const b = new WordBoard(2)
    b.add([{ text: 'old' }], 'other', 1)
    b.keep('old', 1)
    b.add([{ text: 'w1' }], 'other', 2)
    b.add([{ text: 'w2' }], 'other', 3)
    b.add([{ text: 'w3' }], 'other', 4)
    expect(texts(b.recent())).toEqual(['w3', 'w2'])
    expect(texts(b.kept())).toEqual(['old'])
  })
})
