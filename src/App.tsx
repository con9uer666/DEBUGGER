import Editor, { type OnMount } from '@monaco-editor/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'

import './App.css'
import {
  defaultProjectProfile,
  emptyDebugSessionState,
  type CommandResult,
  type DebugControlCommand,
  type EnvironmentCheckResult,
  type DebugSessionState,
  type EnvironmentInfo,
  type LogEvent,
  type OpenFileResult,
  type ProjectFileEntry,
  type ProjectProfile,
  type ProjectScanResult,
  type StackFrame,
  type WatchSample,
  type WatchValue,
} from './shared/contracts'

type ActiveTab = 'editor' | 'memory' | 'registers'

const sampleToolchainHints = [
  '建议 toolchain file 指向 STM32 的 arm-none-eabi CMake 工具链文件',
  'OpenOCD 配置可填写 board/st_nucleo_f4.cfg 或 interface/stlink.cfg;target/stm32f4x.cfg',
  'ELF 文件通常位于 build 目录，如 build/app.elf',
]

const defaultEnvironment: EnvironmentInfo = {
  platform: 'win32',
  nodeVersion: '',
  defaultCmakePath: 'cmake',
  defaultOpenOcdPath: 'openocd',
  defaultGdbPath: 'arm-none-eabi-gdb',
  defaultBuildDir: 'build',
  defaultGenerator: 'Ninja',
}

const emptyEnvironmentCheck: EnvironmentCheckResult = {
  checkedAt: '',
  ready: false,
  tools: [],
}

const MAX_SCOPE_POINTS = 600
const SCOPE_WIDTH = 760
const SCOPE_HEIGHT = 240

function clampSamplingHz(value: number) {
  const normalized = Number.isFinite(value) ? Math.round(value) : 1000
  return Math.min(1000, Math.max(1, normalized))
}

function formatFrequency(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 Hz'
  }

  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} Hz`
}

function formatNumericValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) {
    return value.toExponential(2)
  }

  return value.toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function formatSampleAge(timestamp: number | null) {
  if (!timestamp) {
    return '无样本'
  }

  const ageMs = Math.max(0, Date.now() - timestamp)

  if (ageMs < 1000) {
    return `${Math.round(ageMs)} ms 前`
  }

  return `${(ageMs / 1000).toFixed(1)} s 前`
}

interface WatchOscilloscopeProps {
  expression: string | null
  samples: WatchSample[]
  active: boolean
  lastNumericValue: number | null
  lastError: string | null
}

function WatchOscilloscope({ expression, samples, active, lastNumericValue, lastError }: WatchOscilloscopeProps) {
  const geometry = useMemo(() => {
    const paddingX = 22
    const paddingY = 18
    const plotWidth = SCOPE_WIDTH - paddingX * 2
    const plotHeight = SCOPE_HEIGHT - paddingY * 2

    if (samples.length < 2) {
      return {
        points: '',
        minValue: null,
        maxValue: null,
        durationMs: 0,
        lastPoint: null as { x: number; y: number } | null,
        paddingX,
        paddingY,
        plotWidth,
        plotHeight,
      }
    }

    const firstTimestamp = samples[0].timestamp
    const lastTimestamp = samples[samples.length - 1].timestamp
    const durationMs = Math.max(1, lastTimestamp - firstTimestamp)
    const values = samples.map((sample) => sample.value)
    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const span = maxValue - minValue || Math.max(Math.abs(maxValue), 1)
    const paddedMin = minValue - span * 0.12
    const paddedMax = maxValue + span * 0.12
    const paddedSpan = paddedMax - paddedMin || 1

    const points = samples
      .map((sample) => {
        const x = paddingX + ((sample.timestamp - firstTimestamp) / durationMs) * plotWidth
        const normalized = (sample.value - paddedMin) / paddedSpan
        const y = SCOPE_HEIGHT - paddingY - normalized * plotHeight
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')

    const lastSample = samples[samples.length - 1]
    const lastX = paddingX + ((lastSample.timestamp - firstTimestamp) / durationMs) * plotWidth
    const lastNormalized = (lastSample.value - paddedMin) / paddedSpan
    const lastY = SCOPE_HEIGHT - paddingY - lastNormalized * plotHeight

    return {
      points,
      minValue,
      maxValue,
      durationMs,
      lastPoint: { x: lastX, y: lastY },
      paddingX,
      paddingY,
      plotWidth,
      plotHeight,
    }
  }, [samples])

  if (!expression) {
    return <div className="scope-empty">先从监视列表中选择一个变量，再开启示波采样。</div>
  }

  if (samples.length < 2 || !geometry.points) {
    return (
      <div className="scope-empty">
        <strong>{expression}</strong>
        <span>{lastError ?? (active ? '正在等待数值样本...' : '示波器待命中，点击“开始示波”即可采样。')}</span>
        <small>当前数值 {formatNumericValue(lastNumericValue)}</small>
      </div>
    )
  }

  return (
    <div className="scope-stage">
      <div className="scope-axis-label top">MAX {formatNumericValue(geometry.maxValue)}</div>
      <div className="scope-axis-label bottom">MIN {formatNumericValue(geometry.minValue)}</div>
      <svg className="scope-canvas" viewBox={`0 0 ${SCOPE_WIDTH} ${SCOPE_HEIGHT}`} preserveAspectRatio="none">
        {Array.from({ length: 5 }, (_, index) => {
          const y = geometry.paddingY + (geometry.plotHeight / 4) * index

          return <line key={`h-${index}`} className="scope-grid-line" x1={geometry.paddingX} y1={y} x2={SCOPE_WIDTH - geometry.paddingX} y2={y} />
        })}
        {Array.from({ length: 6 }, (_, index) => {
          const x = geometry.paddingX + (geometry.plotWidth / 5) * index

          return <line key={`v-${index}`} className="scope-grid-line" x1={x} y1={geometry.paddingY} x2={x} y2={SCOPE_HEIGHT - geometry.paddingY} />
        })}
        <polyline className="scope-trace" points={geometry.points} />
        {geometry.lastPoint ? <circle className="scope-trace-dot" cx={geometry.lastPoint.x} cy={geometry.lastPoint.y} r="4" /> : null}
      </svg>
      <div className="scope-footer">
        <span>{expression}</span>
        <span>窗口 {Math.round(geometry.durationMs)} ms</span>
        <span>最新值 {formatNumericValue(lastNumericValue)}</span>
      </div>
    </div>
  )
}

function createLogText(logs: LogEvent[]) {
  return logs
    .map((entry) => `[${entry.timestamp}] [${entry.source}/${entry.stream}] ${entry.text}`)
    .join('')
}

function formatFrame(frame: StackFrame | null) {
  if (!frame) {
    return '未停在任何栈帧'
  }

  const location = frame.file && frame.line ? `${frame.file}:${frame.line}` : frame.address ?? 'unknown'
  return `${frame.functionName} @ ${location}`
}

function initialScan(profile: ProjectProfile): ProjectScanResult {
  return {
    projectRoot: profile.projectRoot,
    cmakeListsPath: null,
    sourceFiles: [],
  }
}

function mapBreakpointsByFile(debugState: DebugSessionState) {
  const result = new Map<string, Set<number>>()

  for (const breakpoint of debugState.breakpoints) {
    const lines = result.get(breakpoint.file) ?? new Set<number>()
    lines.add(breakpoint.line)
    result.set(breakpoint.file, lines)
  }

  return result
}

function App() {
  const [environment, setEnvironment] = useState<EnvironmentInfo>(defaultEnvironment)
  const [profile, setProfile] = useState<ProjectProfile>(defaultProjectProfile)
  const [environmentCheck, setEnvironmentCheck] = useState<EnvironmentCheckResult>(emptyEnvironmentCheck)
  const [scan, setScan] = useState<ProjectScanResult>(initialScan(defaultProjectProfile))
  const [activeFile, setActiveFile] = useState<OpenFileResult | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('editor')
  const [debugState, setDebugState] = useState<DebugSessionState>(emptyDebugSessionState)
  const [buildLogs, setBuildLogs] = useState<LogEvent[]>([])
  const [debugLogs, setDebugLogs] = useState<LogEvent[]>([])
  const [watchDraft, setWatchDraft] = useState('')
  const [variableValueDraft, setVariableValueDraft] = useState('')
  const [selectedWatch, setSelectedWatch] = useState('')
  const [scopeSamples, setScopeSamples] = useState<WatchSample[]>([])
  const [samplingTargetHz, setSamplingTargetHz] = useState(1000)
  const [statusText, setStatusText] = useState('Ready')
  const [isBusy, setIsBusy] = useState(false)
  const [editorReady, setEditorReady] = useState(false)

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const decorationIdsRef = useRef<string[]>([])
  const samplingExpressionRef = useRef<string | null>(null)

  const breakpointMap = useMemo(() => mapBreakpointsByFile(debugState), [debugState])
  const buildLogText = useMemo(() => createLogText(buildLogs), [buildLogs])
  const debugLogText = useMemo(() => createLogText(debugLogs), [debugLogs])

  useEffect(() => {
    window.stm32Debug
      .getEnvironmentInfo()
      .then((info) => {
        setEnvironment(info)
        setProfile((current) => ({
          ...current,
          buildDir: info.defaultBuildDir,
          generator: info.defaultGenerator,
          cmakePath: info.defaultCmakePath,
          openOcdPath: info.defaultOpenOcdPath,
          gdbPath: info.defaultGdbPath,
        }))
      })
      .catch((error: Error) => {
        setStatusText(error.message)
      })

    void window.stm32Debug
      .checkHostEnvironment()
      .then((result) => {
        setEnvironmentCheck(result)
        setStatusText(result.ready ? '运行环境检查通过' : '运行环境不完整，请根据面板提示补齐')
      })
      .catch((error: Error) => {
        setStatusText(error.message)
      })

    const offBuild = window.stm32Debug.onBuildLog((event) => {
      setBuildLogs((current) => [...current, event].slice(-500))
    })
    const offDebug = window.stm32Debug.onDebugLog((event) => {
      setDebugLogs((current) => [...current, event].slice(-500))
    })
    const offState = window.stm32Debug.onDebugState((state) => {
      if (samplingExpressionRef.current !== state.watchSampling.expression) {
        samplingExpressionRef.current = state.watchSampling.expression
        setScopeSamples([])
      }

      setDebugState(state)
      setSamplingTargetHz(state.watchSampling.targetHz)
      setStatusText(`${state.status} | ${formatFrame(state.currentFrame)}`)
    })
    const offSamples = window.stm32Debug.onWatchSamples((batch) => {
      if (samplingExpressionRef.current !== batch.expression) {
        return
      }

      setScopeSamples((current) => [...current, ...batch.samples].slice(-MAX_SCOPE_POINTS))
    })

    return () => {
      offBuild()
      offDebug()
      offState()
      offSamples()
    }
  }, [])

  useEffect(() => {
    if (!editorReady || !editorRef.current || !monacoRef.current || !activeFile) {
      return
    }

    const monaco = monacoRef.current
    const activeBreakpoints = [...(breakpointMap.get(activeFile.path) ?? new Set<number>())]
    const decorations = [
      ...activeBreakpoints.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          glyphMarginClassName: 'editor-breakpoint-glyph',
          glyphMarginHoverMessage: { value: `Breakpoint at line ${line}` },
          className: 'editor-breakpoint-line',
        },
      })),
      ...(() => {
        const frame = debugState.currentFrame

        if (!frame || !frame.fullPath || !frame.line || frame.fullPath !== activeFile.path) {
          return []
        }

        editorRef.current?.revealLineInCenter(frame.line)

        return [
          {
            range: new monaco.Range(frame.line, 1, frame.line, 1),
            options: {
              isWholeLine: true,
              glyphMarginClassName: 'editor-current-line-glyph',
              glyphMarginHoverMessage: { value: 'Current execution line' },
              className: 'editor-current-line',
            },
          },
        ]
      })(),
    ]

    decorationIdsRef.current = editorRef.current.deltaDecorations(decorationIdsRef.current, decorations)
  }, [activeFile, breakpointMap, debugState.currentFrame, editorReady])

  async function withBusyState<T>(label: string, action: () => Promise<T>) {
    setIsBusy(true)
    setStatusText(label)

    try {
      return await action()
    } catch (error) {
      setStatusText((error as Error).message)
      return undefined
    } finally {
      setIsBusy(false)
    }
  }

  function updateProfile<Key extends keyof ProjectProfile>(key: Key, value: ProjectProfile[Key]) {
    setProfile((current) => ({ ...current, [key]: value }))
  }

  async function openProjectRoot() {
    const directory = await window.stm32Debug.chooseDirectory(profile.projectRoot || undefined)

    if (!directory) {
      return
    }

    const nextProfile = { ...profile, projectRoot: directory }
    setProfile(nextProfile)
    await refreshProject(nextProfile)
  }

  async function runEnvironmentCheck() {
    await withBusyState('检查测试机环境...', async () => {
      const result = await window.stm32Debug.checkHostEnvironment()
      setEnvironmentCheck(result)
      setStatusText(result.ready ? '运行环境检查通过' : '运行环境不完整，请根据面板提示补齐')
    })
  }

  async function refreshProject(sourceProfile = profile) {
    if (!sourceProfile.projectRoot) {
      setStatusText('请先选择 STM32 项目根目录。')
      return
    }

    await withBusyState('扫描项目中...', async () => {
      const result = await window.stm32Debug.scanProject(sourceProfile.projectRoot, sourceProfile.buildDir)
      setScan(result)

      if (result.sourceFiles.length > 0 && !activeFile) {
        await openFile(result.sourceFiles[0])
      }
    })
  }

  async function openFile(entry: ProjectFileEntry) {
    const file = await window.stm32Debug.readSourceFile(entry.path)
    setActiveFile(file)
    setActiveTab('editor')
    setStatusText(`已打开 ${entry.relativePath}`)
  }

  async function chooseFileForField(key: 'toolchainFile' | 'elfFile') {
    if (!profile.projectRoot) {
      setStatusText('请先选择项目目录。')
      return
    }

    const selected = await window.stm32Debug.chooseFile({
      title: key === 'toolchainFile' ? '选择 CMake toolchain file' : '选择 ELF 文件',
      defaultPath: profile.projectRoot,
      filters:
        key === 'toolchainFile'
          ? [{ name: 'CMake files', extensions: ['cmake', 'txt'] }]
          : [{ name: 'ELF files', extensions: ['elf', 'axf', 'out'] }],
    })

    if (selected) {
      updateProfile(key, selected)
    }
  }

  function handleCommandResult(result: CommandResult, successText: string) {
    if (result.success) {
      setStatusText(successText)
      return
    }

    setStatusText(`失败: ${result.command}`)
  }

  async function configureProject() {
    await withBusyState('CMake configure...', async () => {
      setBuildLogs([])
      const result = await window.stm32Debug.configureProject(profile)
      handleCommandResult(result, 'CMake configure 完成')
    })
  }

  async function buildProject() {
    await withBusyState('CMake build...', async () => {
      const result = await window.stm32Debug.buildProject(profile)
      handleCommandResult(result, 'CMake build 完成')
    })
  }

  async function generateVsCodeFiles() {
    await withBusyState('生成 VS Code 调试配置...', async () => {
      const result = await window.stm32Debug.generateVsCodeFiles(profile)
      setStatusText(`已生成: ${result.tasksPath}, ${result.launchPath}, ${result.settingsPath}`)
    })
  }

  async function startDebugSession() {
    await withBusyState('连接 OpenOCD / GDB...', async () => {
      setDebugLogs([])
      const state = await window.stm32Debug.startDebugSession(profile)
      setDebugState(state)
      setStatusText(`已连接调试器 | ${formatFrame(state.currentFrame)}`)
    })
  }

  async function programDevice() {
    await withBusyState('下载程序到开发板...', async () => {
      setDebugLogs([])
      const result = await window.stm32Debug.programDevice(profile)
      handleCommandResult(result, '程序已下载到开发板')
    })
  }

  async function stopDebugSession() {
    await withBusyState('停止调试会话...', async () => {
      const state = await window.stm32Debug.stopDebugSession()
      setDebugState(state)
      setStatusText('调试会话已停止')
    })
  }

  async function sendControl(command: DebugControlCommand) {
    await withBusyState(`调试命令: ${command}`, async () => {
      const state = await window.stm32Debug.sendDebugControl(command)
      setDebugState(state)
    })
  }

  async function toggleBreakpoint(lineNumber: number) {
    if (!activeFile) {
      return
    }

    const currentLines = [...(breakpointMap.get(activeFile.path) ?? new Set<number>())]
    const nextLines = currentLines.includes(lineNumber)
      ? currentLines.filter((line) => line !== lineNumber)
      : [...currentLines, lineNumber]

    const state = await window.stm32Debug.setBreakpoints(activeFile.path, nextLines)
    setDebugState(state)
  }

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    setEditorReady(true)

    editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        return
      }

      const lineNumber = event.target.position?.lineNumber

      if (!lineNumber) {
        return
      }

      void toggleBreakpoint(lineNumber)
    })
  }

  async function addWatchExpression() {
    const expression = watchDraft.trim()

    if (!expression) {
      return
    }

    const nextExpressions = [...debugState.watches.map((entry) => entry.expression), expression]
    const state = await window.stm32Debug.setWatchExpressions(nextExpressions)
    setDebugState(state)
    setWatchDraft('')
  }

  async function refreshWatchValues() {
    const state = await window.stm32Debug.refreshWatches()
    setDebugState(state)
  }

  async function configureWatchSampling(enabled: boolean) {
    const expression = enabled ? selectedWatch : null

    if (enabled && !expression) {
      setStatusText('请先选择一个监视变量，再开启示波。')
      return
    }

    await withBusyState(enabled ? `开启 ${expression} 示波采样` : '停止示波采样', async () => {
      const state = await window.stm32Debug.configureWatchSampling({
        expression,
        enabled,
        targetHz: samplingTargetHz,
      })
      setDebugState(state)
      setStatusText(
        enabled
          ? `示波器已连接到 ${expression}，目标频率 ${formatFrequency(state.watchSampling.targetHz)}`
          : '示波采样已停止',
      )
    })
  }

  async function removeWatch(expression: string) {
    if (!expression) {
      return
    }

    const nextExpressions = debugState.watches
      .map((entry) => entry.expression)
      .filter((entry) => entry !== expression)
    const state = await window.stm32Debug.setWatchExpressions(nextExpressions)
    setDebugState(state)

    if (selectedWatch === expression) {
      setSelectedWatch('')
      setVariableValueDraft('')
    }
  }

  async function applyVariableValue() {
    if (!selectedWatch || !variableValueDraft.trim()) {
      return
    }

    await withBusyState(`修改变量 ${selectedWatch}`, async () => {
      const state = await window.stm32Debug.setVariable(selectedWatch, variableValueDraft.trim())
      setDebugState(state)
      setStatusText(`已写入变量 ${selectedWatch}`)
    })
  }

  function renderWatchRow(entry: WatchValue) {
    const isSelected = selectedWatch === entry.expression
    const isScoped = debugState.watchSampling.expression === entry.expression
    const hintText = entry.error
      ? '读取失败'
      : isScoped
        ? debugState.watchSampling.active
          ? '示波采样中'
          : '示波已挂起'
        : '点击后可编辑或挂到示波器'

    return (
      <button
        key={entry.expression}
        className={isSelected ? 'watch-row selected' : 'watch-row'}
        onClick={() => {
          setSelectedWatch(entry.expression)
          setVariableValueDraft(entry.value)
        }}
      >
        <div className="watch-row-topline">
          <span>{entry.expression}</span>
          {isScoped ? <small className="scope-chip">Scope</small> : null}
        </div>
        <strong>{entry.error ? `ERR: ${entry.error}` : entry.value || '-'}</strong>
        <small>{hintText}</small>
      </button>
    )
  }

  const scopeModeLabel = debugState.watchSampling.active
    ? 'Live'
    : debugState.watchSampling.enabled
      ? 'Armed'
      : 'Idle'

  return (
    <div className="workbench-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">STM32 / OpenOCD / DAPLink</p>
          <h1>STM32 Debug Studio</h1>
        </div>
        <div className="status-pill-group">
          <span className="status-pill">{environment.platform}</span>
          <span className={debugState.connected ? 'status-pill active' : 'status-pill'}>
            {debugState.connected ? 'Debugger Connected' : 'Debugger Idle'}
          </span>
          <span className={debugState.running ? 'status-pill running' : 'status-pill'}>
            {debugState.running ? 'Running' : 'Halted'}
          </span>
        </div>
      </header>

      <section className="hero-panel">
        <div>
          <h2>面向 Windows 的 STM32 图形化调试工作台</h2>
          <p>
            统一管理 CMake 构建、OpenOCD 连接、GDB 单步、断点、调用栈、变量监视与 VS Code 调试配置生成。
          </p>
        </div>
        <div className="hero-actions">
          <button onClick={() => void openProjectRoot()} disabled={isBusy}>
            选择工程目录
          </button>
          <button onClick={() => void refreshProject()} disabled={isBusy || !profile.projectRoot}>
            重新扫描工程
          </button>
          <button onClick={() => void runEnvironmentCheck()} disabled={isBusy}>
            环境自检
          </button>
          <button onClick={() => void generateVsCodeFiles()} disabled={isBusy || !profile.projectRoot}>
            生成 VS Code 配置
          </button>
        </div>
      </section>

      <main className="workspace-grid">
        <aside className="left-panel panel">
          <section className="panel-section form-panel">
            <div className="panel-header">
              <h3>Project Profile</h3>
              <span>{scan.sourceFiles.length} files</span>
            </div>

            <label>
              <span>Project Root</span>
              <input value={profile.projectRoot} onChange={(event) => updateProfile('projectRoot', event.target.value)} />
            </label>
            <div className="field-row">
              <label>
                <span>Build Dir</span>
                <input value={profile.buildDir} onChange={(event) => updateProfile('buildDir', event.target.value)} />
              </label>
              <label>
                <span>Generator</span>
                <input value={profile.generator} onChange={(event) => updateProfile('generator', event.target.value)} />
              </label>
            </div>
            <div className="field-row">
              <label>
                <span>Build Type</span>
                <input value={profile.buildType} onChange={(event) => updateProfile('buildType', event.target.value)} />
              </label>
              <label>
                <span>Jobs</span>
                <input
                  type="number"
                  min={1}
                  value={profile.jobs}
                  onChange={(event) => updateProfile('jobs', Number(event.target.value || '1'))}
                />
              </label>
            </div>
            <label>
              <span>Toolchain File</span>
              <div className="chooser-row">
                <input value={profile.toolchainFile} onChange={(event) => updateProfile('toolchainFile', event.target.value)} />
                <button type="button" onClick={() => void chooseFileForField('toolchainFile')}>
                  ...
                </button>
              </div>
            </label>
            <label>
              <span>CMake Extra Args</span>
              <input value={profile.configureArgs} onChange={(event) => updateProfile('configureArgs', event.target.value)} />
            </label>
            <label>
              <span>Build Target</span>
              <input value={profile.buildTarget} onChange={(event) => updateProfile('buildTarget', event.target.value)} />
            </label>
            <label>
              <span>OpenOCD Path</span>
              <input value={profile.openOcdPath} onChange={(event) => updateProfile('openOcdPath', event.target.value)} />
            </label>
            <label>
              <span>OpenOCD Config</span>
              <textarea rows={3} value={profile.openOcdConfig} onChange={(event) => updateProfile('openOcdConfig', event.target.value)} />
            </label>
            <label>
              <span>GDB Path</span>
              <input value={profile.gdbPath} onChange={(event) => updateProfile('gdbPath', event.target.value)} />
            </label>
            <label>
              <span>ELF File</span>
              <div className="chooser-row">
                <input value={profile.elfFile} onChange={(event) => updateProfile('elfFile', event.target.value)} />
                <button type="button" onClick={() => void chooseFileForField('elfFile')}>
                  ...
                </button>
              </div>
            </label>

            <div className="toggle-grid">
              <label className="toggle-row">
                <input type="checkbox" checked={profile.flashOnConnect} onChange={(event) => updateProfile('flashOnConnect', event.target.checked)} />
                <span>Connect 时下载 ELF</span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={profile.resetAfterConnect} onChange={(event) => updateProfile('resetAfterConnect', event.target.checked)} />
                <span>Connect 后 reset halt</span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={profile.runToMain} onChange={(event) => updateProfile('runToMain', event.target.checked)} />
                <span>自动运行到 main</span>
              </label>
            </div>

            <div className="action-grid">
              <button onClick={() => void configureProject()} disabled={isBusy || !profile.projectRoot}>
                Configure
              </button>
              <button onClick={() => void buildProject()} disabled={isBusy || !profile.projectRoot}>
                Build
              </button>
              <button onClick={() => void programDevice()} disabled={isBusy || !profile.projectRoot || !profile.elfFile}>
                Program Device
              </button>
              <button onClick={() => void startDebugSession()} disabled={isBusy || !profile.projectRoot || !profile.elfFile}>
                Start Debug
              </button>
              <button onClick={() => void stopDebugSession()} disabled={isBusy || !debugState.connected}>
                Stop Debug
              </button>
            </div>

            <ul className="hint-list">
              {sampleToolchainHints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="panel-section file-browser">
            <div className="panel-header">
              <h3>Source Explorer</h3>
              <span>{scan.cmakeListsPath ? 'CMake detected' : 'No CMakeLists.txt'}</span>
            </div>
            <div className="file-list">
              {scan.sourceFiles.map((entry) => (
                <button key={entry.path} className={activeFile?.path === entry.path ? 'file-item active' : 'file-item'} onClick={() => void openFile(entry)}>
                  <span>{entry.name}</span>
                  <small>{entry.relativePath}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="editor-panel panel">
          <div className="panel-header editor-toolbar">
            <div>
              <h3>{activeFile ? activeFile.path : 'Editor'}</h3>
              <span>{statusText}</span>
            </div>
            <div className="toolbar-buttons">
              <button onClick={() => void sendControl('continue')} disabled={!debugState.connected || isBusy}>
                Continue
              </button>
              <button onClick={() => void sendControl('pause')} disabled={!debugState.connected || isBusy}>
                Pause
              </button>
              <button onClick={() => void sendControl('step-over')} disabled={!debugState.connected || isBusy}>
                Step Over
              </button>
              <button onClick={() => void sendControl('step-into')} disabled={!debugState.connected || isBusy}>
                Step Into
              </button>
              <button onClick={() => void sendControl('step-out')} disabled={!debugState.connected || isBusy}>
                Step Out
              </button>
              <button onClick={() => void sendControl('reset')} disabled={!debugState.connected || isBusy}>
                Reset
              </button>
            </div>
          </div>

          <div className="tab-strip">
            <button className={activeTab === 'editor' ? 'active' : ''} onClick={() => setActiveTab('editor')}>
              Source
            </button>
            <button className={activeTab === 'memory' ? 'active' : ''} onClick={() => setActiveTab('memory')}>
              Memory Preview
            </button>
            <button className={activeTab === 'registers' ? 'active' : ''} onClick={() => setActiveTab('registers')}>
              Register Notes
            </button>
          </div>

          {activeTab === 'editor' ? (
            <div className="editor-surface">
              <Editor
                height="100%"
                path={activeFile?.path}
                language={activeFile?.language ?? 'c'}
                value={activeFile?.content ?? '// 请选择左侧工程文件'}
                theme="vs-dark"
                onMount={handleEditorMount}
                options={{
                  glyphMargin: true,
                  fontSize: 14,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  readOnly: true,
                  renderLineHighlight: 'all',
                  automaticLayout: true,
                }}
              />
            </div>
          ) : null}

          {activeTab === 'memory' ? (
            <div className="placeholder-card">
              <h3>Memory 窗口</h3>
              <p>当前 MVP 已接通变量监视与变量写入，内存按地址视图可在下一阶段基于 GDB MI 扩展。</p>
              <pre>{debugState.watches.map((entry) => `${entry.expression} = ${entry.value || entry.error || '-'}`).join('\n')}</pre>
            </div>
          ) : null}

          {activeTab === 'registers' ? (
            <div className="placeholder-card">
              <h3>Register Notes</h3>
              <p>当前版本聚焦于断点、单步、调用栈与全局变量监视/修改，寄存器窗口预留给后续迭代。</p>
              <pre>{formatFrame(debugState.currentFrame)}</pre>
            </div>
          ) : null}

          <div className="log-grid">
            <section className="log-panel">
              <div className="panel-header compact">
                <h3>Build Log</h3>
                <span>{buildLogs.length} events</span>
              </div>
              <pre>{buildLogText || '等待构建输出...'}</pre>
            </section>
            <section className="log-panel">
              <div className="panel-header compact">
                <h3>Debug Log</h3>
                <span>{debugLogs.length} events</span>
              </div>
              <pre>{debugLogText || '等待调试输出...'}</pre>
            </section>
          </div>
        </section>

        <aside className="right-panel panel">
          <section className="panel-section">
            <div className="panel-header">
              <div>
                <h3>Watch + Scope</h3>
                <span>连续采样与变量修改集中在这一栏</span>
              </div>
              <div className="watch-badge-group">
                <span className={debugState.watchSampling.active ? 'watch-badge live' : 'watch-badge'}>{scopeModeLabel}</span>
                <span className="watch-badge accent">{formatFrequency(debugState.watchSampling.achievedHz)}</span>
              </div>
            </div>
            <div className="watch-metrics-grid">
              <article className="metric-card">
                <span>Scope Channel</span>
                <strong>{debugState.watchSampling.expression ?? selectedWatch ?? '未选择'}</strong>
                <small>从监视列表中点选一个变量后开启示波</small>
              </article>
              <article className="metric-card">
                <span>当前频率</span>
                <strong>{formatFrequency(debugState.watchSampling.achievedHz)}</strong>
                <small>实时按最近 1 秒样本数统计</small>
              </article>
              <article className="metric-card">
                <span>目标频率</span>
                <strong>{formatFrequency(debugState.watchSampling.targetHz)}</strong>
                <small>当前实现上限 1000 Hz</small>
              </article>
              <article className="metric-card">
                <span>最近样本</span>
                <strong>{formatSampleAge(debugState.watchSampling.lastSampleAt)}</strong>
                <small>最新数值 {debugState.watchSampling.lastValue || '-'}</small>
              </article>
            </div>
            <div className="watch-toolbar">
              <div className="watch-composer">
                <input value={watchDraft} onChange={(event) => setWatchDraft(event.target.value)} placeholder="globalCounter" />
                <button onClick={() => void addWatchExpression()}>Add</button>
                <button onClick={() => void refreshWatchValues()}>Refresh</button>
              </div>
              <div className="sampling-controls">
                <label>
                  <span>Scope Hz</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={samplingTargetHz}
                    onChange={(event) => setSamplingTargetHz(clampSamplingHz(Number(event.target.value || '1000')))}
                  />
                </label>
                <button onClick={() => void configureWatchSampling(true)} disabled={!selectedWatch || isBusy}>
                  Start Scope
                </button>
                <button onClick={() => void configureWatchSampling(false)} disabled={!debugState.watchSampling.enabled || isBusy}>
                  Stop Scope
                </button>
              </div>
            </div>
            <div className="watch-workspace">
              <div className="watch-column">
                <div className="watch-list">
                  {debugState.watches.length > 0 ? (
                    debugState.watches.map((entry) => renderWatchRow(entry))
                  ) : (
                    <div className="empty-list-state">还没有监视变量。先输入一个全局变量名，再点击 Add。</div>
                  )}
                </div>
                <div className="watch-edit-box">
                  <label>
                    <span>Selected Watch</span>
                    <input value={selectedWatch} readOnly />
                  </label>
                  <label>
                    <span>New Value</span>
                    <input value={variableValueDraft} onChange={(event) => setVariableValueDraft(event.target.value)} />
                  </label>
                  <div className="action-grid single-row">
                    <button onClick={() => void applyVariableValue()} disabled={!selectedWatch || isBusy}>
                      Write Variable
                    </button>
                    <button onClick={() => void removeWatch(selectedWatch)} disabled={!selectedWatch || isBusy}>
                      Remove Watch
                    </button>
                  </div>
                </div>
              </div>
              <div className="scope-card">
                <div className="scope-header">
                  <div>
                    <h4>示波器</h4>
                    <span>{debugState.watchSampling.expression ?? '未挂载变量'}</span>
                  </div>
                  <div className="scope-meta">
                    <strong>{formatNumericValue(debugState.watchSampling.lastNumericValue)}</strong>
                    <small>{debugState.watchSampling.lastError ?? '仅绘制可解析为数字的标量变量'}</small>
                  </div>
                </div>
                <WatchOscilloscope
                  expression={debugState.watchSampling.expression}
                  samples={scopeSamples}
                  active={debugState.watchSampling.active}
                  lastNumericValue={debugState.watchSampling.lastNumericValue}
                  lastError={debugState.watchSampling.lastError}
                />
              </div>
            </div>
          </section>

          <section className="panel-section">
            <div className="panel-header">
              <h3>Call Stack</h3>
              <span>{debugState.lastStopReason ?? 'idle'}</span>
            </div>
            <div className="stack-list">
              {debugState.stack.map((frame) => (
                <button
                  key={`${frame.level}-${frame.functionName}-${frame.line}`}
                  className={debugState.currentFrame?.level === frame.level ? 'stack-row active' : 'stack-row'}
                  onClick={() => {
                    if (!frame.fullPath) {
                      return
                    }

                    void openFile({
                      name: frame.file ?? frame.fullPath,
                      path: frame.fullPath,
                      relativePath: frame.file ?? frame.fullPath,
                      language: 'c',
                    })
                  }}
                >
                  <strong>{frame.functionName}</strong>
                  <span>{frame.file ? `${frame.file}:${frame.line ?? '-'}` : frame.address ?? 'unknown'}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <div className="panel-header">
              <h3>Session Snapshot</h3>
              <span>{debugState.status}</span>
            </div>
            <dl className="summary-grid">
              <div>
                <dt>Current Frame</dt>
                <dd>{formatFrame(debugState.currentFrame)}</dd>
              </div>
              <div>
                <dt>Breakpoints</dt>
                <dd>{debugState.breakpoints.length}</dd>
              </div>
              <div>
                <dt>Node</dt>
                <dd>{environment.nodeVersion || '-'}</dd>
              </div>
              <div>
                <dt>CMake</dt>
                <dd>{profile.cmakePath}</dd>
              </div>
              <div>
                <dt>GDB</dt>
                <dd>{profile.gdbPath}</dd>
              </div>
              <div>
                <dt>OpenOCD</dt>
                <dd>{profile.openOcdPath}</dd>
              </div>
            </dl>
          </section>

          <section className="panel-section">
            <div className="panel-header">
              <h3>Host Diagnostics</h3>
              <span>{environmentCheck.ready ? 'Ready' : 'Missing tools'}</span>
            </div>
            <div className="diagnostic-list">
              {environmentCheck.tools.map((tool) => (
                <div key={tool.command} className="diagnostic-item">
                  <div className="diagnostic-topline">
                    <strong>{tool.name}</strong>
                    <span className={tool.found ? 'diagnostic-badge ok' : 'diagnostic-badge bad'}>
                      {tool.found ? 'FOUND' : 'MISSING'}
                    </span>
                  </div>
                  <p>{tool.version ?? tool.installHint}</p>
                  <small>{tool.resolvedPath ?? tool.installHint}</small>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

export default App
