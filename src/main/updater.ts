import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'

/**
 * GitHub の Releases に新しい版があれば裏でダウンロードし、終わったら再起動するか聞く。
 * 開発中（npm run dev）は何もしない。
 */
export function checkForUpdates(): void {
  if (!app.isPackaged) return
  const { autoUpdater } = electronUpdater
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['今すぐ再起動', 'あとで'],
      defaultId: 0,
      cancelId: 1,
      message: `新しい版（${info.version}）の準備ができました`,
      detail: '「あとで」を選んだ場合は、次にアプリを閉じたときに入れ替わります。'
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  // 通信できないときなどは黙って諦める（次の起動でまた確かめる）
  autoUpdater.on('error', (err) => console.warn('[updater]', err.message))
  autoUpdater.checkForUpdates().catch(() => {})
}
