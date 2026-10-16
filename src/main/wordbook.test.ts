import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Wordbook } from './wordbook'

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'wb-')), 'wordbook.json')

describe('Wordbook', () => {
  it('stores the shortened folder name on moved words', async () => {
    const wb = new Wordbook(tmpFile())
    await wb.save({ word: '変数', context: '', savedAt: '2026-10-15T10:00:00Z' })
    await wb.move(['変数'], 'あ'.repeat(50))
    expect(wb.list().folders).toEqual(['あ'.repeat(40)])
    expect(wb.list().entries[0].folder).toBe('あ'.repeat(40))
  })

  it('keeps saving after a failed write', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'wb-')), 'later')
    const file = join(dir, 'wordbook.json')
    const wb = new Wordbook(file)
    await expect(wb.save({ word: '稟議', context: '', savedAt: '2026-10-15T10:00:00Z' })).rejects.toThrow()
    mkdirSync(dir)
    await wb.save({ word: 'KPI', context: '', savedAt: '2026-10-15T10:01:00Z' })
    expect(JSON.parse(readFileSync(file, 'utf8')).entries).toHaveLength(2)
  })

  it('saves, merges and removes entries on disk', async () => {
    const file = tmpFile()
    const wb = new Wordbook(file)
    await wb.save({ word: '稟議', context: '稟議を回します', savedAt: '2026-10-15T10:00:00Z' })
    await wb.save({ word: 'KPI', context: 'KPIの話', savedAt: '2026-10-15T10:01:00Z' })
    await wb.save({ word: '冪等性', context: '', savedAt: '2026-10-15T10:01:30Z' })
    // 意味があとから届いたら、同じ言葉に足す
    await wb.save({ word: '稟議', meaning: '社内の承認手続き', context: '', savedAt: '2026-10-15T10:02:00Z' })
    expect(wb.list().entries.map((e) => e.word)).toEqual(['稟議', '冪等性', 'KPI'])
    expect(wb.list().entries[0]).toMatchObject({ meaning: '社内の承認手続き', context: '稟議を回します' })

    await wb.remove(['KPI', '冪等性'])
    const reloaded = new Wordbook(file)
    expect(reloaded.list().entries.map((e) => e.word)).toEqual(['稟議'])
    expect(JSON.parse(readFileSync(file, 'utf8')).entries).toHaveLength(1)
  })

  it('moves words between folders and keeps them when a folder is deleted', async () => {
    const file = tmpFile()
    const wb = new Wordbook(file)
    for (const word of ['変数', '代入', '稟議']) await wb.save({ word, context: '', savedAt: '2026-10-15T10:00:00Z' })
    await wb.move(['変数', '代入'], 'プログラミング')
    await wb.createFolder('仕事')
    await wb.move(['稟議'], '仕事')
    // 保存し直してもフォルダは変わらない
    await wb.save({ word: '変数', meaning: '値を入れる箱', context: '', savedAt: '2026-10-15T11:00:00Z' })
    expect(wb.list().folders).toEqual(['プログラミング', '仕事'])
    expect(wb.list().entries.find((e) => e.word === '変数')?.folder).toBe('プログラミング')

    await wb.renameFolder('プログラミング', 'プログラム')
    await expect(wb.renameFolder('プログラム', '仕事')).rejects.toThrow('もうあります')
    await wb.deleteFolder('仕事')
    await wb.move(['代入'], null)
    const reloaded = new Wordbook(file).list()
    expect(reloaded.folders).toEqual(['プログラム'])
    expect(Object.fromEntries(reloaded.entries.map((e) => [e.word, e.folder ?? null]))).toEqual({
      変数: 'プログラム',
      代入: null,
      稟議: null
    })
  })

  it('reads the old format (a plain list of words)', () => {
    const file = tmpFile()
    writeFileSync(file, JSON.stringify([{ word: '稟議', context: '', savedAt: '2026-10-15T10:00:00Z' }]))
    expect(new Wordbook(file).list()).toMatchObject({ folders: [], entries: [{ word: '稟議' }] })
  })
})
