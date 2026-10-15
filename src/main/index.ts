import { join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, screen, session } from 'electron'

const PANEL_WIDTH = 380

function createPanel(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()

  // 画面の右端に縦長のパネルとして常に最前面に置く
  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: workArea.height,
    x: workArea.x + workArea.width - PANEL_WIDTH,
    y: workArea.y,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    title: 'Talking Word',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  // 通話アプリの全画面表示よりも上に出す
  win.setAlwaysOnTop(true, 'screen-saver')

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function allowAudioCapture(): void {
  // マイクの許可
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  // getDisplayMedia が呼ばれたら、画面選択ダイアログを出さずに
  // PC全体の再生音（相手の声）をループバックで渡す。映像は渡すが renderer 側ですぐ止める。
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' })
    })
  })
}

app.whenReady().then(() => {
  allowAudioCapture()
  createPanel()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPanel()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
