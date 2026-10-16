import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { PROVIDERS, type ProviderId } from './ai/chat'

interface StoredSettings {
  /** 使う AI の会社 */
  provider?: ProviderId
  /** 会社ごとの API キー。OS の暗号化（Windows は DPAPI）で暗号化して base64 にしたもの */
  keys?: Partial<Record<ProviderId, string>>
  /** 以前の版の保存場所（Sarashina だけだったころ）。読むときに keys へ移す */
  sarashinaKey?: string
}

const file = () => join(app.getPath('userData'), 'settings.json')

function read(): StoredSettings {
  try {
    const s = existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as StoredSettings) : {}
    if (s.sarashinaKey) {
      s.keys = { sarashina: s.sarashinaKey, ...s.keys }
      delete s.sarashinaKey
    }
    return s
  } catch {
    return {}
  }
}

/**
 * 読んで書き換えて書き戻す処理を、1つずつ順番に行う。
 * AI を切り替えてすぐキーを保存したときなどに、片方の変更が消えないようにする。
 */
let queue: Promise<unknown> = Promise.resolve()
function update(change: (s: StoredSettings) => StoredSettings): Promise<void> {
  const run = queue
    .catch(() => {})
    .then(async () => {
      await writeFile(file(), JSON.stringify(change(read()), null, 2))
    })
  queue = run
  return run
}

export function getProvider(): ProviderId {
  const p = read().provider
  return p && p in PROVIDERS ? p : 'sarashina'
}

export async function setProvider(provider: ProviderId): Promise<void> {
  if (!(provider in PROVIDERS)) throw new Error(`知らない AI です: ${provider}`)
  await update((s) => ({ ...s, provider }))
}

export function getKey(provider: ProviderId): string | null {
  const enc = read().keys?.[provider]
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export async function setKey(provider: ProviderId, key: string | null): Promise<void> {
  if (key && !safeStorage.isEncryptionAvailable()) throw new Error('この PC ではキーを暗号化して保存できません')
  await update((s) => {
    const keys = { ...s.keys }
    if (key) keys[provider] = safeStorage.encryptString(key).toString('base64')
    else delete keys[provider]
    return { ...s, keys }
  })
}

/** 画面に出すための、キーの有無だけの一覧（キーそのものは渡さない） */
export function keyStates(): Record<ProviderId, boolean> {
  const ids = Object.keys(PROVIDERS) as ProviderId[]
  return Object.fromEntries(ids.map((id) => [id, getKey(id) !== null])) as Record<ProviderId, boolean>
}
