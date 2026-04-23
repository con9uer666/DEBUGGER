import { contextBridge, ipcRenderer } from 'electron'

import type {
  DetachedPanelKind,
  DebugControlCommand,
  FileDialogRequest,
  LogEvent,
  StartDebugRequest,
  Stm32DebugApi,
  WatchExpansionRequest,
  WatchSampleBatch,
  WatchSamplingRequest,
} from '../src/shared/contracts'

function subscribe<T>(channel: string, listener: (payload: T) => void) {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => {
    listener(payload)
  }

  ipcRenderer.on(channel, handler)

  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const api: Stm32DebugApi = {
  chooseDirectory(defaultPath?: string) {
    return ipcRenderer.invoke('app:chooseDirectory', defaultPath)
  },
  chooseFile(request?: FileDialogRequest) {
    return ipcRenderer.invoke('app:chooseFile', request)
  },
  getEnvironmentInfo() {
    return ipcRenderer.invoke('app:getEnvironmentInfo')
  },
  checkHostEnvironment() {
    return ipcRenderer.invoke('app:checkHostEnvironment')
  },
  getDebugState() {
    return ipcRenderer.invoke('debug:getState')
  },
  scanProject(projectRoot: string, buildDir?: string) {
    return ipcRenderer.invoke('project:scan', projectRoot, buildDir)
  },
  readSourceFile(filePath: string) {
    return ipcRenderer.invoke('project:readSourceFile', filePath)
  },
  configureProject(request) {
    return ipcRenderer.invoke('cmake:configure', request)
  },
  buildProject(request) {
    return ipcRenderer.invoke('cmake:build', request)
  },
  generateVsCodeFiles(profile) {
    return ipcRenderer.invoke('vscode:generate', profile)
  },
  openDetachedPanel(kind: DetachedPanelKind) {
    return ipcRenderer.invoke('window:openDetachedPanel', kind)
  },
  startDebugSession(request: StartDebugRequest) {
    return ipcRenderer.invoke('debug:start', request)
  },
  programDevice(request: StartDebugRequest) {
    return ipcRenderer.invoke('debug:program', request)
  },
  stopDebugSession() {
    return ipcRenderer.invoke('debug:stop')
  },
  sendDebugControl(command: DebugControlCommand) {
    return ipcRenderer.invoke('debug:control', command)
  },
  setBreakpoints(filePath: string, lines: number[]) {
    return ipcRenderer.invoke('debug:setBreakpoints', filePath, lines)
  },
  setWatchExpressions(expressions: string[]) {
    return ipcRenderer.invoke('debug:setWatchExpressions', expressions)
  },
  setWatchExpansion(request: WatchExpansionRequest) {
    return ipcRenderer.invoke('debug:setWatchExpansion', request)
  },
  configureWatchSampling(request: WatchSamplingRequest) {
    return ipcRenderer.invoke('debug:configureWatchSampling', request)
  },
  refreshWatches() {
    return ipcRenderer.invoke('debug:refreshWatches')
  },
  setVariable(expression: string, value: string) {
    return ipcRenderer.invoke('debug:setVariable', expression, value)
  },
  onBuildLog(listener: (event: LogEvent) => void) {
    return subscribe('build:log', listener)
  },
  onDebugLog(listener: (event: LogEvent) => void) {
    return subscribe('debug:log', listener)
  },
  onDebugState(listener) {
    return subscribe('debug:state', listener)
  },
  onWatchSamples(listener: (batch: WatchSampleBatch) => void) {
    return subscribe('debug:samples', listener)
  },
}

contextBridge.exposeInMainWorld('stm32Debug', api)