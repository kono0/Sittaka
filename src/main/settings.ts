import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

interface StoredSettings {
  /** OS の暗号化（Windows は DPAPI）で暗号化した API キー（base64） */
  sarashinaKey?: string
}

const file = () => join(app.getPath('userData'), 'settings.json')

function read(): StoredSettings {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as StoredSettings) : {}
  } catch {
    return {}
  }
}

export function getSarashinaKey(): string | null {
  const enc = read().sarashinaKey
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export async function setSarashinaKey(key: string | null): Promise<void> {
  const s = read()
  if (key) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('この PC ではキーを暗号化して保存できません')
    s.sarashinaKey = safeStorage.encryptString(key).toString('base64')
  } else {
    delete s.sarashinaKey
  }
  await writeFile(file(), JSON.stringify(s, null, 2))
}
