import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Wordbook } from './wordbook'

describe('Wordbook', () => {
  it('saves, merges and removes entries on disk', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'wb-')), 'wordbook.json')
    const wb = new Wordbook(file)
    await wb.save({ word: '稟議', context: '稟議を回します', savedAt: '2026-10-15T10:00:00Z' })
    await wb.save({ word: 'KPI', context: 'KPIの話', savedAt: '2026-10-15T10:01:00Z' })
    // 意味があとから届いたら、同じ言葉に足す
    await wb.save({ word: '稟議', meaning: '社内の承認手続き', context: '', savedAt: '2026-10-15T10:02:00Z' })
    expect(wb.list().map((e) => e.word)).toEqual(['稟議', 'KPI'])
    expect(wb.list()[0]).toMatchObject({ meaning: '社内の承認手続き', context: '稟議を回します' })

    await wb.remove('KPI')
    const reloaded = new Wordbook(file)
    expect(reloaded.list().map((e) => e.word)).toEqual(['稟議'])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1)
  })
})
