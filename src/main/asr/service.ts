import { cpus } from 'node:os'
import { join } from 'node:path'
import { app, ipcMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { ensureModel } from './model'
import type { AsrRequest, AsrResponse, Transcript } from './protocol'

type Pending = { resolve(t: Transcript): void; reject(err: Error): void }

/** ReazonSpeech を別プロセスで動かし、画面からの依頼を IPC で受ける */
class ReazonSpeechService {
  private child: UtilityProcess | null = null
  private loading: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()

  load(sender: WebContents, hints: boolean): Promise<void> {
    this.loading ??= this.start(sender, hints).catch((err) => {
      this.stop()
      throw err
    })
    return this.loading
  }

  transcribe(samples: Float32Array, hints?: string[]): Promise<Transcript> {
    const child = this.child
    if (!child) return Promise.reject(new Error('エンジンが起動していません'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.postMessage({ type: 'transcribe', id, samples, hints } satisfies AsrRequest)
    })
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    this.loading = null
    for (const p of this.pending.values()) p.reject(new Error('停止しました'))
    this.pending.clear()
  }

  private async start(sender: WebContents, hints: boolean): Promise<void> {
    const modelDir = await ensureModel(join(app.getPath('userData'), 'models'), (p) => {
      if (!sender.isDestroyed()) sender.send('asr:progress', p)
    })

    const child = utilityProcess.fork(join(__dirname, 'asr-worker.js'), [], { serviceName: 'ReazonSpeech' })
    this.child = child
    await new Promise<void>((resolve, reject) => {
      child.on('message', (msg: AsrResponse) => {
        if (msg.type === 'ready') resolve()
        else if (msg.type === 'result') this.settle(msg.id, (p) => p.resolve(msg.transcript))
        else if (msg.id === undefined) reject(new Error(msg.message))
        else this.settle(msg.id, (p) => p.reject(new Error(msg.message)))
      })
      child.on('exit', (code) => {
        reject(new Error(`文字起こしプロセスが終了しました（code ${code}）`))
        if (this.child === child) this.stop()
      })
      // 会話の処理中も他のアプリが重くならないよう、使うコアは2つまで
      const numThreads = Math.max(1, Math.min(2, cpus().length - 1))
      child.postMessage({ type: 'load', modelDir, numThreads, hints } satisfies AsrRequest)
    })
  }

  private settle(id: number, f: (p: Pending) => void): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    f(p)
  }
}

export function registerAsrIpc(): void {
  const service = new ReazonSpeechService()
  ipcMain.handle('asr:load', (e, hints: boolean) => service.load(e.sender, hints === true))
  ipcMain.handle('asr:transcribe', (_e, samples: Float32Array, hints?: string[]) =>
    service.transcribe(samples, Array.isArray(hints) ? hints.slice(0, 300).map(String) : undefined)
  )
  ipcMain.handle('asr:stop', () => service.stop())
  app.on('will-quit', () => service.stop())
}
