import path from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'

import type {
  DetachedPanelKind,
  DebugControlCommand,
  EnvironmentInfo,
  FileDialogRequest,
  StartDebugRequest,
} from '../src/shared/contracts'
import { buildProject, configureProject } from './services/cmakeService'
import { DebugSession } from './services/debugSession'
import { checkHostEnvironment } from './services/environmentService'
import { generateVsCodeFiles, readSourceFile, scanProject } from './services/projectService'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

const userDataDirectory = path.join(app.getPath('appData'), 'STM32 Debug Studio')
app.setPath('userData', userDataDirectory)
app.setPath('sessionData', path.join(userDataDirectory, 'session-data'))

let mainWindow: BrowserWindow | null = null
const detachedPanelWindows = new Map<DetachedPanelKind, BrowserWindow>()

function sendToRenderers(channel: string, payload: unknown) {
  const windows = [mainWindow, ...detachedPanelWindows.values()].filter(
    (window): window is BrowserWindow => Boolean(window && !window.isDestroyed() && !window.webContents.isDestroyed()),
  )

  for (const window of windows) {
    window.webContents.send(channel, payload)
  }
}

const debugSession = new DebugSession((channel, payload) => {
  sendToRenderers(channel, payload)
})

function getPreloadPath() {
  return path.join(app.getAppPath(), 'dist-electron', 'preload.cjs')
}

async function createMainWindow() {
  return await createWindow('main')
}

async function loadWindowContent(browserWindow: BrowserWindow, panelKind?: DetachedPanelKind) {
  if (isDev) {
    const baseUrl = new URL(process.env.VITE_DEV_SERVER_URL as string)

    if (panelKind) {
      baseUrl.searchParams.set('panel', panelKind)
    }

    await browserWindow.loadURL(baseUrl.toString())
    return
  }

  await browserWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), {
    query: panelKind ? { panel: panelKind } : undefined,
  })
}

async function createWindow(mode: 'main' | DetachedPanelKind) {
  const isDetachedPanel = mode !== 'main'
  const browserWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1280,
    minHeight: 760,
    ...(isDetachedPanel
      ? {
          width: mode === 'watch-scope' ? 980 : 760,
          height: mode === 'watch-scope' ? 720 : 860,
          minWidth: mode === 'watch-scope' ? 760 : 560,
          minHeight: 520,
          title: mode === 'watch-scope' ? 'STM32 Debug Studio - 独立示波器' : 'STM32 Debug Studio - 独立监视表',
          autoHideMenuBar: true,
        }
      : {}),
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  await loadWindowContent(browserWindow, isDetachedPanel ? mode : undefined)

  browserWindow.on('closed', () => {
    if (!isDetachedPanel && mainWindow === browserWindow) {
      mainWindow = null
    }

    if (isDetachedPanel) {
      detachedPanelWindows.delete(mode)
    }
  })

  return browserWindow
}

async function openDetachedPanel(kind: DetachedPanelKind) {
  const existing = detachedPanelWindows.get(kind)

  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const browserWindow = await createWindow(kind)
  detachedPanelWindows.set(kind, browserWindow)
}

function getEnvironmentInfo() {
  return {
    platform: process.platform,
    nodeVersion: process.version,
    defaultCmakePath: 'cmake',
    defaultOpenOcdPath: 'openocd',
    defaultGdbPath: 'arm-none-eabi-gdb',
    defaultBuildDir: 'build',
    defaultGenerator: 'Ninja',
  } satisfies EnvironmentInfo
}

async function showDirectoryPicker(defaultPath?: string) {
  const options: OpenDialogOptions = {
    title: 'Select STM32 project root',
    defaultPath,
    properties: ['openDirectory'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)

  return result.canceled ? null : result.filePaths[0]
}

async function showFilePicker(request?: FileDialogRequest) {
  const options: OpenDialogOptions = {
    title: request?.title ?? 'Select file',
    defaultPath: request?.defaultPath,
    filters: request?.filters,
    properties: ['openFile'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)

  return result.canceled ? null : result.filePaths[0]
}

app.whenReady().then(async () => {
  mainWindow = await createMainWindow()

  ipcMain.handle('app:chooseDirectory', async (_event, defaultPath?: string) => {
    return await showDirectoryPicker(defaultPath)
  })

  ipcMain.handle('app:chooseFile', async (_event, request?: FileDialogRequest) => {
    return await showFilePicker(request)
  })

  ipcMain.handle('app:getEnvironmentInfo', async () => getEnvironmentInfo())
  ipcMain.handle('app:checkHostEnvironment', async () => {
    return await checkHostEnvironment()
  })
  ipcMain.handle('debug:getState', async () => {
    return debugSession.getState()
  })
  ipcMain.handle('project:scan', async (_event, projectRoot: string, buildDir?: string) => {
    return await scanProject(projectRoot, buildDir)
  })
  ipcMain.handle('project:readSourceFile', async (_event, filePath: string) => {
    return await readSourceFile(filePath)
  })

  ipcMain.handle('cmake:configure', async (_event, request) => {
    return await configureProject(request, (payload) => {
      sendToRenderers('build:log', payload)
    })
  })

  ipcMain.handle('cmake:build', async (_event, request) => {
    return await buildProject(request, (payload) => {
      sendToRenderers('build:log', payload)
    })
  })

  ipcMain.handle('vscode:generate', async (_event, request) => {
    return await generateVsCodeFiles(request)
  })

  ipcMain.handle('window:openDetachedPanel', async (_event, kind: DetachedPanelKind) => {
    await openDetachedPanel(kind)
  })

  ipcMain.handle('debug:start', async (_event, request: StartDebugRequest) => {
    return await debugSession.start(request)
  })

  ipcMain.handle('debug:program', async (_event, request: StartDebugRequest) => {
    return await debugSession.programDevice(request)
  })

  ipcMain.handle('debug:stop', async () => {
    return await debugSession.stop()
  })

  ipcMain.handle('debug:control', async (_event, command: DebugControlCommand) => {
    return await debugSession.sendControl(command)
  })

  ipcMain.handle('debug:setBreakpoints', async (_event, filePath: string, lines: number[]) => {
    return await debugSession.setBreakpoints(filePath, lines)
  })

  ipcMain.handle('debug:setWatchExpressions', async (_event, expressions: string[]) => {
    return await debugSession.setWatchExpressions(expressions)
  })

  ipcMain.handle('debug:setWatchExpansion', async (_event, request) => {
    return await debugSession.setWatchExpansion(request)
  })

  ipcMain.handle('debug:configureWatchSampling', async (_event, request) => {
    return await debugSession.configureWatchSampling(request)
  })

  ipcMain.handle('debug:refreshWatches', async () => {
    return await debugSession.refreshWatches()
  })

  ipcMain.handle('debug:setVariable', async (_event, expression: string, value: string) => {
    return await debugSession.setVariable(expression, value)
  })

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  await debugSession.stop()
})