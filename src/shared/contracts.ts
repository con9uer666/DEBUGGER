export interface FileDialogFilter {
  name: string
  extensions: string[]
}

export interface FileDialogRequest {
  title?: string
  defaultPath?: string
  filters?: FileDialogFilter[]
}

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
  value: string
  type?: string
  error?: string
}

export interface DebugSessionState {
  connected: boolean
  running: boolean
  status: string
  currentFrame: StackFrame | null
  stack: StackFrame[]
  breakpoints: DebugBreakpoint[]
  watches: WatchValue[]
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
  refreshWatches(): Promise<DebugSessionState>
  setVariable(expression: string, value: string): Promise<DebugSessionState>
  onBuildLog(listener: (event: LogEvent) => void): () => void
  onDebugLog(listener: (event: LogEvent) => void): () => void
  onDebugState(listener: (state: DebugSessionState) => void): () => void
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
  lastStopReason: null,
}