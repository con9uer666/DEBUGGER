export interface FileDialogFilter {
  name: string
  extensions: string[]
}

export interface FileDialogRequest {
  title?: string
  defaultPath?: string
  filters?: FileDialogFilter[]
}

export type DebuggerPreset = 'custom' | 'daplink' | 'cmsis-dap' | 'stlink' | 'jlink'

export type DebugConfigPreset = 'flash-run-main' | 'flash-reset-halt' | 'attach-reset-halt' | 'attach-live' | 'custom'

export interface ProjectProfile {
  projectRoot: string
  buildDir: string
  generator: string
  buildType: string
  toolchainFile: string
  cmakePath: string
  configureArgs: string
  buildTarget: string
  jobs: number
  debuggerPreset: DebuggerPreset
  debugConfigPreset: DebugConfigPreset
  openOcdPath: string
  openOcdConfig: string
  gdbPath: string
  elfFile: string
  flashOnConnect: boolean
  resetAfterConnect: boolean
  runToMain: boolean
}

export type ConfigureProjectRequest = ProjectProfile

export type BuildProjectRequest = ProjectProfile

export type StartDebugRequest = ProjectProfile

export interface CommandResult {
  success: boolean
  exitCode: number | null
  command: string
  stdout: string
  stderr: string
}

export interface LogEvent {
  source: 'cmake' | 'gdb' | 'openocd' | 'app'
  stream: 'stdout' | 'stderr' | 'info'
  text: string
  timestamp: string
}

export interface ProjectFileEntry {
  name: string
  path: string
  relativePath: string
  language: string
}

export interface ProjectScanResult {
  projectRoot: string
  cmakeListsPath: string | null
  sourceFiles: ProjectFileEntry[]
}

export interface OpenFileResult {
  path: string
  language: string
  content: string
}

export interface StackFrame {
  level: number
  functionName: string
  address?: string
  file?: string
  fullPath?: string
  line?: number
}

export interface DebugBreakpoint {
  id: string
  file: string
  line: number
  enabled: boolean
  verified: boolean
}

export interface WatchValue {
  expression: string
  displayName: string
  value: string
  type?: string
  error?: string
  level: number
  expandable: boolean
  expanded: boolean
  editable: boolean
  childCount: number
  variableObjectName?: string
  children?: WatchValue[]
}

export interface WatchSample {
  timestamp: number
  value: number
}

export interface WatchSampleBatch {
  expression: string
  samples: WatchSample[]
  targetHz: number
  achievedHz: number
}

export interface WatchSamplingRequest {
  expression: string | null
  enabled: boolean
  targetHz: number
}

export interface WatchExpansionRequest {
  variableObjectName: string
  expanded: boolean
}

export interface WatchSamplingStatus {
  enabled: boolean
  active: boolean
  expression: string | null
  targetHz: number
  achievedHz: number
  maxTargetHz: number
  sampleCount: number
  lastSampleAt: number | null
  lastValue: string
  lastNumericValue: number | null
  lastError: string | null
}

export interface DebugSessionState {
  connected: boolean
  running: boolean
  status: string
  currentFrame: StackFrame | null
  stack: StackFrame[]
  breakpoints: DebugBreakpoint[]
  watches: WatchValue[]
  watchSampling: WatchSamplingStatus
  lastStopReason: string | null
}

export interface EnvironmentInfo {
  platform: string
  nodeVersion: string
  defaultCmakePath: string
  defaultOpenOcdPath: string
  defaultGdbPath: string
  defaultBuildDir: string
  defaultGenerator: string
}

export interface EnvironmentToolStatus {
  name: string
  command: string
  required: boolean
  found: boolean
  resolvedPath: string | null
  version: string | null
  installHint: string
}

export interface EnvironmentCheckResult {
  checkedAt: string
  ready: boolean
  tools: EnvironmentToolStatus[]
}

export interface VsCodeGenerationResult {
  tasksPath: string
  launchPath: string
  settingsPath: string
}

export type DebugControlCommand =
  | 'continue'
  | 'pause'
  | 'step-over'
  | 'step-into'
  | 'step-out'
  | 'reset'

export interface Stm32DebugApi {
  chooseDirectory(defaultPath?: string): Promise<string | null>
  chooseFile(request?: FileDialogRequest): Promise<string | null>
  getEnvironmentInfo(): Promise<EnvironmentInfo>
  checkHostEnvironment(): Promise<EnvironmentCheckResult>
  scanProject(projectRoot: string, buildDir?: string): Promise<ProjectScanResult>
  readSourceFile(filePath: string): Promise<OpenFileResult>
  configureProject(request: ConfigureProjectRequest): Promise<CommandResult>
  buildProject(request: BuildProjectRequest): Promise<CommandResult>
  generateVsCodeFiles(profile: ProjectProfile): Promise<VsCodeGenerationResult>
  programDevice(request: StartDebugRequest): Promise<CommandResult>
  startDebugSession(request: StartDebugRequest): Promise<DebugSessionState>
  stopDebugSession(): Promise<DebugSessionState>
  sendDebugControl(command: DebugControlCommand): Promise<DebugSessionState>
  setBreakpoints(filePath: string, lines: number[]): Promise<DebugSessionState>
  setWatchExpressions(expressions: string[]): Promise<DebugSessionState>
  setWatchExpansion(request: WatchExpansionRequest): Promise<DebugSessionState>
  configureWatchSampling(request: WatchSamplingRequest): Promise<DebugSessionState>
  refreshWatches(): Promise<DebugSessionState>
  setVariable(expression: string, value: string): Promise<DebugSessionState>
  onBuildLog(listener: (event: LogEvent) => void): () => void
  onDebugLog(listener: (event: LogEvent) => void): () => void
  onDebugState(listener: (state: DebugSessionState) => void): () => void
  onWatchSamples(listener: (batch: WatchSampleBatch) => void): () => void
}

export const defaultProjectProfile: ProjectProfile = {
  projectRoot: '',
  buildDir: 'build',
  generator: 'Ninja',
  buildType: 'Debug',
  toolchainFile: '',
  cmakePath: 'cmake',
  configureArgs: '',
  buildTarget: '',
  jobs: 8,
  debuggerPreset: 'custom',
  debugConfigPreset: 'flash-run-main',
  openOcdPath: 'openocd',
  openOcdConfig: '',
  gdbPath: 'arm-none-eabi-gdb',
  elfFile: '',
  flashOnConnect: true,
  resetAfterConnect: true,
  runToMain: true,
}

export const emptyDebugSessionState: DebugSessionState = {
  connected: false,
  running: false,
  status: 'idle',
  currentFrame: null,
  stack: [],
  breakpoints: [],
  watches: [],
  watchSampling: {
    enabled: false,
    active: false,
    expression: null,
    targetHz: 1000,
    achievedHz: 0,
    maxTargetHz: 1000,
    sampleCount: 0,
    lastSampleAt: null,
    lastValue: '',
    lastNumericValue: null,
    lastError: null,
  },
  lastStopReason: null,
}