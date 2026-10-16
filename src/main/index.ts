import { join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeTheme, screen, session } from 'electron'
import { registerAiIpc } from './ai/ipc'
import { registerAsrIpc } from './asr/service'
import { registerTermsIpc } from './terms/ipc'

const PANEL_WIDTH = 380
const WIDE_PANEL_WIDTH = 760
const MINI_WIDTH = 340
const MINI_HEIGHT = 250
const MINI_MARGIN = 12

function createPanel(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()

  // 画面の右端に縦長のパネルとして常に最前面に置く
  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: workArea.height,
    x: workArea.x + workArea.width - PANEL_WIDTH,
    y: workArea.y,
    minWidth: 280,
    minHeight: 160,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    // 見た目を Windows のライト・ダークに合わせるため、枠は自前で描く（上の帯をつかんで動かせる）
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15171b' : '#f5f6f8',
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
  // 画面共有や録画にこのパネルが映らないようにする（Windows 10 2004 以降・macOS）
  win.setContentProtection(true)

  // 表示の大きさ。右端はそろえたまま変える
  //  full: 画面の高さいっぱいの縦長パネル（検証タブを開いている間は幅を広げる）
  //  mini: 画面の右上の小さな帯
  let mode: 'full' | 'mini' = 'full'
  let wide = false
  const layout = () => {
    const b = win.getBounds()
    const { workArea } = screen.getDisplayMatching(b)
    const right = b.x + b.width
    if (mode === 'mini') {
      win.setBounds({ x: right - MINI_WIDTH, y: workArea.y + MINI_MARGIN, width: MINI_WIDTH, height: MINI_HEIGHT })
    } else {
      const width = wide ? WIDE_PANEL_WIDTH : PANEL_WIDTH
      win.setBounds({ x: right - width, y: workArea.y, width, height: workArea.height })
    }
  }
  ipcMain.handle('panel:setWide', (_e, w: boolean) => {
    if (w === wide) return
    wide = w
    if (mode === 'full') layout()
  })
  ipcMain.handle('panel:setMode', (_e, m: 'full' | 'mini') => {
    if (m === mode) return
    mode = m
    layout()
  })

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

/**
 * パネルを触らずに操作するためのショートカット。通話アプリを前面にしたままでも効く。
 * Ctrl+Alt+1〜9: 言葉の一覧で上から N 番目をキープ / Ctrl+Alt+M: 小さくする・広げる / Ctrl+Alt+H: パネルを隠す・出す
 */
function registerHotkeys(win: BrowserWindow): void {
  for (let n = 1; n <= 9; n++) {
    globalShortcut.register(`CommandOrControl+Alt+${n}`, () => win.webContents.send('hotkey:keep', n))
  }
  globalShortcut.register('CommandOrControl+Alt+M', () => win.webContents.send('hotkey:toggleMode'))
  globalShortcut.register('CommandOrControl+Alt+H', () => {
    if (win.isVisible()) win.hide()
    else win.showInactive()
  })
}

app.whenReady().then(() => {
  allowAudioCapture()
  registerAsrIpc()
  registerTermsIpc()
  registerAiIpc()
  registerHotkeys(createPanel())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPanel()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
