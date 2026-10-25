import { app, ipcMain, shell, BrowserWindow, type WebContents } from 'electron'
import { dirname, extname, join } from 'path'
import { IMAGE_EXTENSIONS, type OpenedFile } from '../shared/types'
import { registerFolderHandlers } from './folderHandlers'
import { registerThumbnailProtocol, registerThumbnailScheme } from './thumbnailProtocol'
import { checkForUpdates } from './updater'

registerThumbnailScheme()

// An image opened from Finder (double-click on an associated file, Open With, or a drop
// on the Dock icon). macOS can send it before the window exists, even before `ready`,
// so it waits here until the page asks for it on start.
let pendingFile: OpenedFile | null = null
let pageContents: WebContents | null = null

app.on('open-file', (event, filePath) => {
  if (!IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) return
  event.preventDefault()
  const file = { folder: dirname(filePath), path: filePath }
  if (pageContents && !pageContents.isDestroyed()) {
    pageContents.send('file:opened', file)
    BrowserWindow.fromWebContents(pageContents)?.focus()
    return
  }
  pendingFile = file
  // The app keeps running on macOS with every window closed.
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow()
})

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d1220',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerThumbnailProtocol()
  registerFolderHandlers()

  ipcMain.handle('file:takeOpened', (event): OpenedFile | null => {
    pageContents = event.sender
    const file = pendingFile
    pendingFile = null
    return file
  })

  createWindow()
  checkForUpdates()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
