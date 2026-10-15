import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('appInfo', {
  platform: process.platform
})

contextBridge.exposeInMainWorld('asr', {
  load(onProgress: (p: { percent: number | null; message: string }) => void): Promise<void> {
    const listener = (_e: IpcRendererEvent, p: { percent: number | null; message: string }) => onProgress(p)
    ipcRenderer.on('asr:progress', listener)
    return ipcRenderer.invoke('asr:load').finally(() => ipcRenderer.removeListener('asr:progress', listener))
  },
  transcribe: (samples: Float32Array): Promise<string> => ipcRenderer.invoke('asr:transcribe', samples),
  stop: (): Promise<void> => ipcRenderer.invoke('asr:stop')
})
