import path from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'

import type {
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

function sendToRenderer(channel: string, payload: unknown) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return
  }

  mainWindow.webContents.send(channel, payload)
}

const debugSession = new DebugSession((channel, payload) => {
  sendToRenderer(channel, payload)
})

function getPreloadPath() {
  return path.join(app.getAppPath(), 'dist-electron', 'preload.cjs')
}

async function createMainWindow() {
  const browserWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1280,
    minHeight: 760,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    await browserWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string)
  } else {
    await browserWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }

  browserWindow.on('closed', () => {
    if (mainWindow === browserWindow) {
      mainWindow = null
    }
  })

  return browserWindow
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
  ipcMain.handle('project:scan', async (_event, projectRoot: string, buildDir?: string) => {
    return await scanProject(projectRoot, buildDir)
  })
  ipcMain.handle('project:readSourceFile', async (_event, filePath: string) => {
    return await readSourceFile(filePath)
  })

  ipcMain.handle('cmake:configure', async (_event, request) => {
    return await configureProject(request, (payload) => {
      sendToRenderer('build:log', payload)
    })
  })

  ipcMain.handle('cmake:build', async (_event, request) => {
    return await buildProject(request, (payload) => {
      sendToRenderer('build:log', payload)
    })
  })

  ipcMain.handle('vscode:generate', async (_event, request) => {
    return await generateVsCodeFiles(request)
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