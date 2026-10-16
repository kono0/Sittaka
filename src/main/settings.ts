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

const write = (s: StoredSettings) => writeFile(file(), JSON.stringify(s, null, 2))

export function getProvider(): ProviderId {
  const p = read().provider
  return p && p in PROVIDERS ? p : 'sarashina'
}

export async function setProvider(provider: ProviderId): Promise<void> {
  if (!(provider in PROVIDERS)) throw new Error(`知らない AI です: ${provider}`)
  await write({ ...read(), provider })
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
  const s = read()
  const keys = { ...s.keys }
  if (key) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('この PC ではキーを暗号化して保存できません')
    keys[provider] = safeStorage.encryptString(key).toString('base64')
  } else {
    delete keys[provider]
  }
  await write({ ...s, keys })
}

/** 画面に出すための、キーの有無だけの一覧（キーそのものは渡さない） */
export function keyStates(): Record<ProviderId, boolean> {
  const ids = Object.keys(PROVIDERS) as ProviderId[]
  return Object.fromEntries(ids.map((id) => [id, getKey(id) !== null])) as Record<ProviderId, boolean>
}
