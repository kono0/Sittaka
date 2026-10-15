import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('appInfo', {
  platform: process.platform
})
