import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { net } from 'electron'
import { MODEL_ARCHIVE_ROOT, MODEL_ARCHIVE_URL, MODEL_FILES, MODEL_ID } from './model-files'

export interface ModelProgress {
  percent: number | null
  message: string
}

/** モデルがなければダウンロードして展開し、置き場所のフォルダを返す */
export async function ensureModel(baseDir: string, onProgress: (p: ModelProgress) => void): Promise<string> {
  const dir = join(baseDir, MODEL_ID)
  const files = Object.values(MODEL_FILES)
  if (files.every((f) => existsSync(join(dir, f)))) return dir

  await mkdir(baseDir, { recursive: true })
  const archive = join(baseDir, `${MODEL_ID}.tar.bz2.part`)
  const tmp = join(baseDir, `${MODEL_ID}.tmp`)

  try {
    await download(MODEL_ARCHIVE_URL, archive, onProgress)

    onProgress({ percent: null, message: 'モデルを展開しています…' })
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    await untar(archive, tmp, files.map((f) => `${MODEL_ARCHIVE_ROOT}/${f}`))

    await rm(dir, { recursive: true, force: true })
    await rename(join(tmp, MODEL_ARCHIVE_ROOT), dir)
    return dir
  } finally {
    await rm(archive, { force: true })
    await rm(tmp, { recursive: true, force: true })
  }
}

async function download(url: string, dest: string, onProgress: (p: ModelProgress) => void): Promise<void> {
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`モデルをダウンロードできませんでした（HTTP ${res.status}）`)
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0
  let lastReport = 0

  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length
      const now = Date.now()
      if (now - lastReport > 250) {
        lastReport = now
        const mb = (received / 1e6).toFixed(0)
        onProgress({
          percent: total ? (received / total) * 100 : null,
          message: total ? `モデルをダウンロード中 ${mb} / ${(total / 1e6).toFixed(0)}MB` : `モデルをダウンロード中 ${mb}MB`
        })
      }
      cb(null, chunk)
    }
  })

  await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(dest))
}

function untar(archive: string, destDir: string, members: string[]): Promise<void> {
  // Windows 10 以降に標準で入っている bsdtar を使う（Git 付属の GNU tar を避けるため絶対パスで呼ぶ）
  const tar =
    process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ['-xjf', archive, '-C', destDir, ...members], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`モデルの展開に失敗しました: ${stderr.trim() || `code ${code}`}`))
    )
  })
}
