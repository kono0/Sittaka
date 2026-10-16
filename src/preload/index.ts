import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Transcript } from '../main/asr/protocol'

contextBridge.exposeInMainWorld('appInfo', {
  platform: process.platform,
  openDoc: (name: 'privacy' | 'notices') => ipcRenderer.invoke('app:openDoc', name)
})

contextBridge.exposeInMainWorld('asr', {
  load(onProgress: (p: { percent: number | null; message: string }) => void): Promise<void> {
    const listener = (_e: IpcRendererEvent, p: { percent: number | null; message: string }) => onProgress(p)
    ipcRenderer.on('asr:progress', listener)
    return ipcRenderer.invoke('asr:load').finally(() => ipcRenderer.removeListener('asr:progress', listener))
  },
  transcribe: (samples: Float32Array): Promise<Transcript> => ipcRenderer.invoke('asr:transcribe', samples),
  stop: (): Promise<void> => ipcRenderer.invoke('asr:stop')
})

contextBridge.exposeInMainWorld('terms', {
  extract: (text: string) => ipcRenderer.invoke('terms:extract', text)
})

contextBridge.exposeInMainWorld('hotkeys', {
  onKeep(handler: (n: number) => void): void {
    ipcRenderer.on('hotkey:keep', (_e, n: number) => handler(n))
  },
  onToggleMode(handler: () => void): void {
    ipcRenderer.on('hotkey:toggleMode', () => handler())
  }
})

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  setProvider: (provider: string) => ipcRenderer.invoke('settings:setProvider', provider),
  setKey: (provider: string, key: string | null) => ipcRenderer.invoke('settings:setKey', provider, key)
})

contextBridge.exposeInMainWorld('ai', {
  refine: (context: string[], utterance: string, candidates: string[], amount: string) =>
    ipcRenderer.invoke('ai:refine', context, utterance, candidates, amount),
  explain: (context: string[], word: string) => ipcRenderer.invoke('ai:explain', context, word)
})

contextBridge.exposeInMainWorld('wordbook', {
  list: () => ipcRenderer.invoke('wordbook:list'),
  save: (entry: unknown) => ipcRenderer.invoke('wordbook:save', entry),
  remove: (words: string[]) => ipcRenderer.invoke('wordbook:remove', words),
  move: (words: string[], folder: string | null) => ipcRenderer.invoke('wordbook:move', words, folder),
  createFolder: (name: string) => ipcRenderer.invoke('wordbook:createFolder', name),
  renameFolder: (from: string, to: string) => ipcRenderer.invoke('wordbook:renameFolder', from, to),
  deleteFolder: (name: string) => ipcRenderer.invoke('wordbook:deleteFolder', name)
})

contextBridge.exposeInMainWorld('panel', {
  setWide: (wide: boolean) => ipcRenderer.invoke('panel:setWide', wide),
  setMode: (mode: 'full' | 'mini') => ipcRenderer.invoke('panel:setMode', mode)
})
