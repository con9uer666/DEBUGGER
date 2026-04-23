import Editor, { type OnMount } from '@monaco-editor/react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'

import './App.css'
import {
  type DetachedPanelKind,
  defaultProjectProfile,
  emptyDebugSessionState,
  type CommandResult,
  type DebugConfigPreset,
  type DebugControlCommand,
  type DebugTargetPreset,
  type DebuggerPreset,
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

type ActiveTab = 'editor' | 'memory' | 'registers' | 'logs'
type LeftPanelView = 'project' | 'files'
type RightPanelView = 'watch' | 'session'
type WatchPanelView = 'table' | 'scope'
type IconName =
  | 'folder'
  | 'refresh'
  | 'tool'
  | 'vscode'
  | 'list'
  | 'play'
  | 'download'
  | 'stop'
  | 'pause'
  | 'step-over'
  | 'step-into'
  | 'step-out'
  | 'reset'
  | 'more'
  | 'plus'
  | 'wave'
  | 'write'
  | 'remove'
  | 'info'
  | 'stack'
  | 'popout'

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

function Icon({ name }: { name: IconName }) {
  const commonProps = {
    className: 'button-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'folder':
      return (
        <svg {...commonProps}>
          <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8A1.5 1.5 0 0 1 20.5 9.5v7A1.5 1.5 0 0 1 19 18H5A1.5 1.5 0 0 1 3.5 16.5z" />
        </svg>
      )
    case 'refresh':
      return (
        <svg {...commonProps}>
          <path d="M20 6v5h-5" />
          <path d="M4 18v-5h5" />
          <path d="M6.7 10A7 7 0 0 1 18 7l2 4" />
          <path d="M17.3 14A7 7 0 0 1 6 17l-2-4" />
        </svg>
      )
    case 'tool':
      return (
        <svg {...commonProps}>
          <path d="M4 21l5.4-5.4" />
          <path d="M14.5 6.5a4 4 0 1 0 3 3l2.5 2.5 1.5-1.5-2.5-2.5a4 4 0 0 0-4.5-1z" />
        </svg>
      )
    case 'vscode':
      return (
        <svg {...commonProps}>
          <path d="M16 4l4 2v12l-4 2-8-7z" />
          <path d="M8 9L4 6 2 8l4 4-4 4 2 2 4-3" />
        </svg>
      )
    case 'list':
      return (
        <svg {...commonProps}>
          <path d="M9 6h10" />
          <path d="M9 12h10" />
          <path d="M9 18h10" />
          <circle cx="5" cy="6" r="1" />
          <circle cx="5" cy="12" r="1" />
          <circle cx="5" cy="18" r="1" />
        </svg>
      )
    case 'play':
      return (
        <svg {...commonProps}>
          <path d="M8 6.5v11l8-5.5z" />
        </svg>
      )
    case 'download':
      return (
        <svg {...commonProps}>
          <path d="M12 4v10" />
          <path d="M8.5 10.5L12 14l3.5-3.5" />
          <path d="M4 18h16" />
        </svg>
      )
    case 'stop':
      return (
        <svg {...commonProps}>
          <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...commonProps}>
          <path d="M9 6v12" />
          <path d="M15 6v12" />
        </svg>
      )
    case 'step-over':
      return (
        <svg {...commonProps}>
          <path d="M4 7h16" />
          <path d="M8 11h8" />
          <path d="M12 11v6" />
          <path d="M9.5 14.5L12 17l2.5-2.5" />
        </svg>
      )
    case 'step-into':
      return (
        <svg {...commonProps}>
          <path d="M4 7h16" />
          <path d="M8 11h5" />
          <path d="M13 11v6" />
          <path d="M10.5 14.5L13 17l2.5-2.5" />
        </svg>
      )
    case 'step-out':
      return (
        <svg {...commonProps}>
          <path d="M4 7h16" />
          <path d="M13 17v-6" />
          <path d="M10.5 13.5L13 11l2.5 2.5" />
          <path d="M13 11h5" />
        </svg>
      )
    case 'reset':
      return (
        <svg {...commonProps}>
          <path d="M20 5v5h-5" />
          <path d="M20 10a8 8 0 1 0 2 5.5" />
        </svg>
      )
    case 'more':
      return (
        <svg {...commonProps}>
          <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...commonProps}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      )
    case 'wave':
      return (
        <svg {...commonProps}>
          <path d="M2 13c2 0 2-6 4-6s2 10 4 10 2-10 4-10 2 6 4 6 2-2 4-2" />
        </svg>
      )
    case 'write':
      return (
        <svg {...commonProps}>
          <path d="M4 20l4-.8 8.8-8.8-3.2-3.2L4.8 16z" />
          <path d="M12.8 7.2l3.2 3.2" />
        </svg>
      )
    case 'remove':
      return (
        <svg {...commonProps}>
          <path d="M5 7h14" />
          <path d="M9 7V5.5h6V7" />
          <path d="M8 7l1 11h6l1-11" />
        </svg>
      )
    case 'info':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6" />
          <path d="M12 7.5h.01" />
        </svg>
      )
    case 'stack':
      return (
        <svg {...commonProps}>
          <path d="M12 4l8 4-8 4-8-4z" />
          <path d="M4 12l8 4 8-4" />
          <path d="M4 16l8 4 8-4" />
        </svg>
      )
    case 'popout':
      return (
        <svg {...commonProps}>
          <path d="M14 5h5v5" />
          <path d="M19 5l-7 7" />
          <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V14" />
        </svg>
      )
    default:
      return null
  }
}

function ButtonLabel({ icon, text }: { icon: IconName; text: string }) {
  return (
    <span className="button-label">
      <Icon name={icon} />
      <span>{text}</span>
    </span>
  )
}

const MAX_SCOPE_POINTS = 600
const SCOPE_WIDTH = 760
const SCOPE_HEIGHT = 240
const SCOPE_PALETTE = ['#f8b749', '#57d0ff', '#70f0a8', '#ff8d78', '#d9a6ff', '#ffd76e']
const SCOPE_TIMEBASE_OPTIONS = [250, 500, 1000, 2000, 5000, 10000]

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

function formatScopeTimebase(value: number) {
  if (value >= 1000) {
    const seconds = value / 1000
    return Number.isInteger(seconds) ? `${seconds} s` : `${seconds.toFixed(1)} s`
  }

  return `${value} ms`
}

function formatScopeRelativeTime(value: number) {
  if (value === 0) {
    return '0'
  }

  const absolute = Math.abs(value)
  const suffix = absolute >= 1000 ? `${(absolute / 1000).toFixed(absolute % 1000 === 0 ? 0 : 1)}s` : `${Math.round(absolute)}ms`
  return value < 0 ? `-${suffix}` : suffix
}

function formatSessionStatus(status: string) {
  switch (status) {
    case 'connecting':
      return '连接中'
    case 'running':
      return '运行中'
    case 'halted':
      return '已停住'
    case 'programming':
      return '下载中'
    case 'idle':
      return '空闲'
    default:
      return status
  }
}

function formatControlCommand(command: DebugControlCommand) {
  switch (command) {
    case 'continue':
      return '继续'
    case 'pause':
      return '暂停'
    case 'step-over':
      return '单步越过'
    case 'step-into':
      return '单步进入'
    case 'step-out':
      return '单步跳出'
    case 'reset':
      return '复位'
    default:
      return command
  }
}

interface ScopeTraceView {
  expression: string
  samples: WatchSample[]
  lastValue: string
  lastNumericValue: number | null
  lastError: string | null
  color: string
}

interface WatchOscilloscopeProps {
  traces: ScopeTraceView[]
  active: boolean
  timebaseMs: number
  statusMessage: string | null
}

function WatchOscilloscope({ traces, active, timebaseMs, statusMessage }: WatchOscilloscopeProps) {
  const geometry = useMemo(() => {
    const paddingLeft = 56
    const paddingRight = 16
    const paddingTop = 18
    const paddingBottom = 28
    const plotWidth = SCOPE_WIDTH - paddingLeft - paddingRight
    const plotHeight = SCOPE_HEIGHT - paddingTop - paddingBottom
    const latestTimestamp = traces.reduce((latest, trace) => {
      const lastSample = trace.samples[trace.samples.length - 1]
      return Math.max(latest, lastSample?.timestamp ?? 0)
    }, 0)
    const windowStart = latestTimestamp > 0 ? Math.max(0, latestTimestamp - timebaseMs) : 0
    const visibleTraces = traces.map((trace) => ({
      ...trace,
      samples: trace.samples.filter((sample) => sample.timestamp >= windowStart),
    }))
    const values = visibleTraces.flatMap((trace) => trace.samples.map((sample) => sample.value))

    if (traces.length === 0 || values.length === 0 || latestTimestamp === 0) {
      return {
        plottedTraces: [] as Array<ScopeTraceView & { points: string; lastPoint: { x: number; y: number } | null }>,
        yTicks: [] as Array<{ y: number; label: string }>,
        xTicks: Array.from({ length: 6 }, (_, index) => {
          const ratio = index / 5
          return {
            x: paddingLeft + plotWidth * ratio,
            label: formatScopeRelativeTime((ratio - 1) * timebaseMs),
          }
        }),
        hasSamples: false,
        plotWidth,
        plotHeight,
        paddingLeft,
        paddingRight,
        paddingTop,
        paddingBottom,
      }
    }

    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const span = maxValue - minValue || Math.max(Math.abs(maxValue), 1)
    const paddedMin = minValue - span * 0.12
    const paddedMax = maxValue + span * 0.12
    const paddedSpan = paddedMax - paddedMin || 1
    const plottedTraces = visibleTraces.map((trace) => {
      const points = trace.samples
        .map((sample) => {
          const ratio = Math.min(1, Math.max(0, (sample.timestamp - windowStart) / Math.max(1, timebaseMs)))
          const x = paddingLeft + ratio * plotWidth
          const normalized = (sample.value - paddedMin) / paddedSpan
          const y = paddingTop + (1 - normalized) * plotHeight
          return `${x.toFixed(2)},${y.toFixed(2)}`
        })
        .join(' ')

      const lastSample = trace.samples.length > 0 ? trace.samples[trace.samples.length - 1] : null
      const lastPoint = lastSample
        ? {
            x: paddingLeft + Math.min(1, Math.max(0, (lastSample.timestamp - windowStart) / Math.max(1, timebaseMs))) * plotWidth,
            y: paddingTop + (1 - (lastSample.value - paddedMin) / paddedSpan) * plotHeight,
          }
        : null

      return {
        ...trace,
        points,
        lastPoint,
      }
    })

    const yTicks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4
      return {
        y: paddingTop + plotHeight * ratio,
        label: formatNumericValue(paddedMax - paddedSpan * ratio),
      }
    })

    return {
      plottedTraces,
      yTicks,
      xTicks: Array.from({ length: 6 }, (_, index) => {
        const ratio = index / 5
        return {
          x: paddingLeft + plotWidth * ratio,
          label: formatScopeRelativeTime((ratio - 1) * timebaseMs),
        }
      }),
      hasSamples: true,
      plotWidth,
      plotHeight,
      paddingLeft,
      paddingRight,
      paddingTop,
      paddingBottom,
    }
  }, [timebaseMs, traces])

  if (traces.length === 0) {
    return <div className="scope-empty">先把变量加入示波器，再开始采样。</div>
  }

  if (!geometry.hasSamples) {
    return (
      <div className="scope-empty">
        <strong>{traces.length} 条示波通道已就绪</strong>
        <span>{statusMessage ?? (active ? '正在等待数值样本...' : '示波器待命中，点击“开始示波”即可采样。')}</span>
        <div className="scope-empty-list">
          {traces.map((trace) => (
            <div key={trace.expression} className="scope-empty-item">
              <span>{trace.expression}</span>
              <small>{trace.lastError ?? `当前值 ${trace.lastValue || formatNumericValue(trace.lastNumericValue)}`}</small>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="scope-stage">
      <svg className="scope-canvas" viewBox={`0 0 ${SCOPE_WIDTH} ${SCOPE_HEIGHT}`} preserveAspectRatio="none">
        {geometry.yTicks.map((tick, index) => (
          <g key={`y-${index}`}>
            <line className="scope-grid-line" x1={geometry.paddingLeft} y1={tick.y} x2={SCOPE_WIDTH - geometry.paddingRight} y2={tick.y} />
            <text className="scope-axis-tick" x={10} y={tick.y + 4}>
              {tick.label}
            </text>
          </g>
        ))}
        {geometry.xTicks.map((tick, index) => (
          <g key={`x-${index}`}>
            <line className="scope-grid-line" x1={tick.x} y1={geometry.paddingTop} x2={tick.x} y2={SCOPE_HEIGHT - geometry.paddingBottom} />
            <text className="scope-axis-tick" x={tick.x} y={SCOPE_HEIGHT - 8} textAnchor={index === 0 ? 'start' : index === geometry.xTicks.length - 1 ? 'end' : 'middle'}>
              {tick.label}
            </text>
          </g>
        ))}
        {geometry.plottedTraces.map((trace) => (
          <g key={trace.expression}>
            <polyline className="scope-trace" points={trace.points} style={{ stroke: trace.color }} />
            {trace.lastPoint ? <circle className="scope-trace-dot" cx={trace.lastPoint.x} cy={trace.lastPoint.y} r="4" style={{ fill: trace.color }} /> : null}
          </g>
        ))}
      </svg>
      <div className="scope-footer">
        <span>时基 {formatScopeTimebase(timebaseMs)}</span>
        <span>{active ? '正在连续采样' : '示波已暂停'}</span>
        {traces.map((trace) => (
          <span key={trace.expression} className="scope-legend-item" style={{ '--scope-trace-color': trace.color } as CSSProperties}>
            {trace.expression}: {trace.lastValue || formatNumericValue(trace.lastNumericValue)}
          </span>
        ))}
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

interface FlattenedWatchRow {
  entry: WatchValue
  treeContinuations: boolean[]
  isLast: boolean
}

interface DebuggerPresetOption {
  value: DebuggerPreset
  label: string
  hint: string
}

interface DebugTargetPresetOption {
  value: DebugTargetPreset
  label: string
  hint: string
}

interface DebugConfigPresetOption {
  value: DebugConfigPreset
  label: string
  hint: string
}

type DebugLaunchFlags = Pick<ProjectProfile, 'flashOnConnect' | 'resetAfterConnect' | 'runToMain'>

type ResizableSidebar = 'left' | 'right'

const debuggerPresetOptions: DebuggerPresetOption[] = [
  { value: 'custom', label: '自定义接口', hint: '手动填写完整 OpenOCD 接口配置' },
  { value: 'daplink', label: 'DAPLink', hint: '自动补入 CMSIS-DAP 接口配置' },
  { value: 'cmsis-dap', label: 'CMSIS-DAP', hint: '适用于通用 CMSIS-DAP 调试器' },
  { value: 'stlink', label: 'ST-Link', hint: '自动补入 ST-Link 接口配置' },
  { value: 'jlink', label: 'J-Link', hint: '自动补入 J-Link 接口配置' },
]

const debugTargetPresetOptions: DebugTargetPresetOption[] = [
  { value: 'custom', label: '自定义目标', hint: '手动填写 target/board 配置' },
  { value: 'target-stm32f0x', label: 'STM32F0 系列', hint: '使用 target/stm32f0x.cfg' },
  { value: 'target-stm32f1x', label: 'STM32F1 系列', hint: '使用 target/stm32f1x.cfg' },
  { value: 'target-stm32f3x', label: 'STM32F3 系列', hint: '使用 target/stm32f3x.cfg' },
  { value: 'target-stm32f4x', label: 'STM32F4 系列', hint: '使用 target/stm32f4x.cfg' },
  { value: 'target-stm32f7x', label: 'STM32F7 系列', hint: '使用 target/stm32f7x.cfg' },
  { value: 'target-stm32g0x', label: 'STM32G0 系列', hint: '使用 target/stm32g0x.cfg' },
  { value: 'target-stm32g4x', label: 'STM32G4 系列', hint: '使用 target/stm32g4x.cfg' },
  { value: 'target-stm32h7x', label: 'STM32H7 系列', hint: '使用 target/stm32h7x.cfg' },
  { value: 'target-stm32l0', label: 'STM32L0 系列', hint: '使用 target/stm32l0.cfg' },
  { value: 'target-stm32l4x', label: 'STM32L4 系列', hint: '使用 target/stm32l4x.cfg' },
  { value: 'board-st-nucleo-f4', label: 'Nucleo-F4 开发板', hint: '使用 board/st_nucleo_f4.cfg' },
  { value: 'board-stm32f4discovery', label: 'STM32F4 Discovery', hint: '使用 board/stm32f4discovery.cfg' },
]

const debugConfigPresetBehaviors: Record<Exclude<DebugConfigPreset, 'custom'>, DebugLaunchFlags> = {
  'flash-run-main': {
    flashOnConnect: true,
    resetAfterConnect: true,
    runToMain: true,
  },
  'flash-reset-halt': {
    flashOnConnect: true,
    resetAfterConnect: true,
    runToMain: false,
  },
  'attach-reset-halt': {
    flashOnConnect: false,
    resetAfterConnect: true,
    runToMain: false,
  },
  'attach-live': {
    flashOnConnect: false,
    resetAfterConnect: false,
    runToMain: false,
  },
}

const debugConfigPresetOptions: DebugConfigPresetOption[] = [
  { value: 'flash-run-main', label: '下载并运行到 main', hint: '连接时下载、复位并自动跑到 main' },
  { value: 'flash-reset-halt', label: '下载后停住', hint: '连接时下载并 reset halt，适合先检查初始化' },
  { value: 'attach-reset-halt', label: '附加并停住', hint: '不下载程序，只 reset halt 并接管目标' },
  { value: 'attach-live', label: '仅附加当前目标', hint: '不下载、不复位，直接附加当前运行状态' },
  { value: 'custom', label: '自定义策略', hint: '手动控制下载、复位和运行到 main' },
]

const debuggerPresetLabels = Object.fromEntries(debuggerPresetOptions.map((option) => [option.value, option.label])) as Record<DebuggerPreset, string>
const debugTargetPresetLabels = Object.fromEntries(debugTargetPresetOptions.map((option) => [option.value, option.label])) as Record<DebugTargetPreset, string>
const debugConfigPresetLabels = Object.fromEntries(debugConfigPresetOptions.map((option) => [option.value, option.label])) as Record<DebugConfigPreset, string>

function getDetachedPanelMode() {
  if (typeof window === 'undefined') {
    return null
  }

  const panel = new URLSearchParams(window.location.search).get('panel')
  return panel === 'watch-table' || panel === 'watch-scope' ? panel : null
}

function clampSidebarWidth(side: ResizableSidebar, width: number) {
  const normalized = Math.round(width)

  if (side === 'left') {
    return Math.min(460, Math.max(250, normalized))
  }

  return Math.min(560, Math.max(290, normalized))
}

function inferDebugConfigPreset(profile: DebugLaunchFlags): DebugConfigPreset {
  const matched = Object.entries(debugConfigPresetBehaviors).find(([, behavior]) => {
    return (
      behavior.flashOnConnect === profile.flashOnConnect &&
      behavior.resetAfterConnect === profile.resetAfterConnect &&
      behavior.runToMain === profile.runToMain
    )
  })

  return (matched?.[0] as DebugConfigPreset | undefined) ?? 'custom'
}

function flattenWatchRows(watches: WatchValue[]) {
  const rows: FlattenedWatchRow[] = []

  function visit(entries: WatchValue[], treeContinuations: boolean[] = []) {
    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1

      rows.push({
        entry,
        treeContinuations,
        isLast,
      })

      if (entry.children && entry.children.length > 0) {
        visit(entry.children, [...treeContinuations, !isLast])
      }
    })
  }

  visit(watches)
  return rows
}

function uniqueExpressions(expressions: string[]) {
  return [...new Set(expressions.map((expression) => expression.trim()).filter(Boolean))]
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function App() {
  const detachedPanelMode = useMemo(() => getDetachedPanelMode(), [])
  const [environment, setEnvironment] = useState<EnvironmentInfo>(defaultEnvironment)
  const [profile, setProfile] = useState<ProjectProfile>(defaultProjectProfile)
  const [environmentCheck, setEnvironmentCheck] = useState<EnvironmentCheckResult>(emptyEnvironmentCheck)
  const [scan, setScan] = useState<ProjectScanResult>(initialScan(defaultProjectProfile))
  const [activeFile, setActiveFile] = useState<OpenFileResult | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('editor')
  const [leftPanelView, setLeftPanelView] = useState<LeftPanelView>('project')
  const [rightPanelView, setRightPanelView] = useState<RightPanelView>('watch')
  const [watchPanelView, setWatchPanelView] = useState<WatchPanelView>('table')
  const [debugState, setDebugState] = useState<DebugSessionState>(emptyDebugSessionState)
  const [buildLogs, setBuildLogs] = useState<LogEvent[]>([])
  const [debugLogs, setDebugLogs] = useState<LogEvent[]>([])
  const [watchDraft, setWatchDraft] = useState('')
  const [variableValueDraft, setVariableValueDraft] = useState('')
  const [selectedWatch, setSelectedWatch] = useState('')
  const [editingWatchExpression, setEditingWatchExpression] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [scopeSamplesByExpression, setScopeSamplesByExpression] = useState<Record<string, WatchSample[]>>({})
  const [scopeExpressionDraft, setScopeExpressionDraft] = useState('')
  const [samplingTargetHz, setSamplingTargetHz] = useState(1000)
  const [scopeTimebaseMs, setScopeTimebaseMs] = useState(1000)
  const [statusText, setStatusText] = useState('就绪')
  const [isBusy, setIsBusy] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(308)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(332)

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const decorationIdsRef = useRef<string[]>([])
  const samplingExpressionsKeyRef = useRef('')
  const resizeStateRef = useRef<{ side: ResizableSidebar; startX: number; startWidth: number } | null>(null)
  const contextMenuPositionRef = useRef<Monaco.Position | null>(null)
  const pendingEditorRevealRef = useRef<{ path: string; lineNumber: number; column: number } | null>(null)
  const sourceFileCacheRef = useRef(new Map<string, OpenFileResult>())
  const scanRef = useRef(scan)
  const activeFileRef = useRef<OpenFileResult | null>(activeFile)
  const definitionLookupRef = useRef<(symbol: string, preferredPath?: string) => Promise<{ path: string; lineNumber: number; column: number } | null>>(
    async () => null,
  )
  const editorActionHandlersRef = useRef<{
    addToWatch: (editor: Monaco.editor.IStandaloneCodeEditor) => Promise<void>
    addToScope: (editor: Monaco.editor.IStandaloneCodeEditor) => Promise<void>
    goToDefinition: (editor: Monaco.editor.IStandaloneCodeEditor) => Promise<void>
  }>({
    addToWatch: async () => undefined,
    addToScope: async () => undefined,
    goToDefinition: async () => undefined,
  })
  const editorEnhancementsRegisteredRef = useRef(false)

  const breakpointMap = useMemo(() => mapBreakpointsByFile(debugState), [debugState])
  const buildLogText = useMemo(() => createLogText(buildLogs), [buildLogs])
  const debugLogText = useMemo(() => createLogText(debugLogs), [debugLogs])
  const visibleWatchRows = useMemo(() => flattenWatchRows(debugState.watches), [debugState.watches])
  const scopedExpressionSet = useMemo(() => new Set(debugState.watchSampling.expressions), [debugState.watchSampling.expressions])
  const selectableWatchExpressions = useMemo(() => {
    const mapped = visibleWatchRows.map(({ entry }) => ({
      expression: entry.expression,
      label: entry.expression,
      type: entry.type,
    }))

    return mapped.filter((entry, index, list) => list.findIndex((candidate) => candidate.expression === entry.expression) === index)
  }, [visibleWatchRows])
  const filteredSourceFiles = useMemo(() => {
    const keyword = sourceFilter.trim().toLowerCase()

    if (!keyword) {
      return scan.sourceFiles
    }

    return scan.sourceFiles.filter((entry) => {
      return entry.name.toLowerCase().includes(keyword) || entry.relativePath.toLowerCase().includes(keyword)
    })
  }, [scan.sourceFiles, sourceFilter])
  const scopeTraceViews = useMemo(() => {
    return debugState.watchSampling.traces.map((trace, index) => ({
      ...trace,
      samples: scopeSamplesByExpression[trace.expression] ?? [],
      color: SCOPE_PALETTE[index % SCOPE_PALETTE.length],
    }))
  }, [debugState.watchSampling.traces, scopeSamplesByExpression])

  function syncScopeSampleBuffers(expressions: string[]) {
    setScopeSamplesByExpression((current) => {
      const next: Record<string, WatchSample[]> = {}

      for (const expression of expressions) {
        next[expression] = current[expression] ?? []
      }

      return next
    })
  }

  useEffect(() => {
    scanRef.current = scan
  }, [scan])

  useEffect(() => {
    activeFileRef.current = activeFile
  }, [activeFile])

  useEffect(() => {
    if (!selectedWatch) {
      return
    }

    if (visibleWatchRows.some((row) => row.entry.expression === selectedWatch)) {
      return
    }

    setSelectedWatch('')

    if (editingWatchExpression === selectedWatch) {
      setEditingWatchExpression('')
      setVariableValueDraft('')
    }
  }, [editingWatchExpression, selectedWatch, visibleWatchRows])

  useEffect(() => {
    if (selectedWatch || debugState.watchSampling.expressions.length === 0) {
      return
    }

    setSelectedWatch(debugState.watchSampling.expressions[0])
  }, [debugState.watchSampling.expressions, selectedWatch])

  useEffect(() => {
    const lastScopeExpression =
      debugState.watchSampling.expressions.length > 0
        ? debugState.watchSampling.expressions[debugState.watchSampling.expressions.length - 1]
        : ''
    const fallbackExpression = selectedWatch || lastScopeExpression || selectableWatchExpressions[0]?.expression || ''

    if (scopeExpressionDraft === fallbackExpression) {
      return
    }

    if (scopeExpressionDraft && selectableWatchExpressions.some((entry) => entry.expression === scopeExpressionDraft)) {
      return
    }

    setScopeExpressionDraft(fallbackExpression)
  }, [debugState.watchSampling.expressions, scopeExpressionDraft, selectableWatchExpressions, selectedWatch])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current

      if (!state) {
        return
      }

      if (state.side === 'left') {
        setLeftSidebarWidth(clampSidebarWidth('left', state.startWidth + event.clientX - state.startX))
        return
      }

      setRightSidebarWidth(clampSidebarWidth('right', state.startWidth - (event.clientX - state.startX)))
    }

    const stopResize = () => {
      resizeStateRef.current = null
      document.body.classList.remove('sidebar-resizing')
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResize)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResize)
    }
  }, [])

  useEffect(() => {
    void window.stm32Debug
      .getDebugState()
      .then((state) => {
        const samplingKey = state.watchSampling.expressions.join('\u0000')

        if (samplingExpressionsKeyRef.current !== samplingKey) {
          samplingExpressionsKeyRef.current = samplingKey
          syncScopeSampleBuffers(state.watchSampling.expressions)
        }

        setDebugState(state)
        setSamplingTargetHz(state.watchSampling.targetHz)
      })
      .catch(() => {
        // Ignore initial state load failures and continue relying on push events.
      })

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

    if (!detachedPanelMode) {
      void window.stm32Debug
        .checkHostEnvironment()
        .then((result) => {
          setEnvironmentCheck(result)
          setStatusText(result.ready ? '运行环境检查通过' : '运行环境不完整，请根据面板提示补齐')
        })
        .catch((error: Error) => {
          setStatusText(error.message)
        })
    }

    const offBuild = window.stm32Debug.onBuildLog((event) => {
      setBuildLogs((current) => [...current, event].slice(-500))
    })
    const offDebug = window.stm32Debug.onDebugLog((event) => {
      setDebugLogs((current) => [...current, event].slice(-500))
    })
    const offState = window.stm32Debug.onDebugState((state) => {
      const samplingKey = state.watchSampling.expressions.join('\u0000')

      if (samplingExpressionsKeyRef.current !== samplingKey) {
        samplingExpressionsKeyRef.current = samplingKey
        syncScopeSampleBuffers(state.watchSampling.expressions)
      }

      setDebugState(state)
      setSamplingTargetHz(state.watchSampling.targetHz)
      setStatusText(`${formatSessionStatus(state.status)} | ${formatFrame(state.currentFrame)}`)
    })
    const offSamples = window.stm32Debug.onWatchSamples((batch) => {
      setScopeSamplesByExpression((current) => {
        const next = { ...current }

        for (const trace of batch.traces) {
          next[trace.expression] = [...(next[trace.expression] ?? []), ...trace.samples].slice(-MAX_SCOPE_POINTS)
        }

        return next
      })
    })

    return () => {
      offBuild()
      offDebug()
      offState()
      offSamples()
    }
  }, [detachedPanelMode])

  useEffect(() => {
    if (!editorReady || !editorRef.current || !monacoRef.current || !activeFile) {
      return
    }

    const monaco = monacoRef.current
    const activeBreakpoints = breakpointMap.get(activeFile.path) ?? new Set<number>()
    const frame = debugState.currentFrame
    const currentLine = frame && frame.fullPath === activeFile.path ? frame.line : null
    const decoratedLines = new Set<number>(activeBreakpoints)

    if (currentLine) {
      decoratedLines.add(currentLine)
      editorRef.current?.revealLineInCenter(currentLine)
    }

    const decorations = [...decoratedLines]
      .sort((left, right) => left - right)
      .map((line) => {
        const hasBreakpoint = activeBreakpoints.has(line)
        const isCurrentLine = currentLine === line
        const classNames = [hasBreakpoint ? 'editor-breakpoint-line' : '', isCurrentLine ? 'editor-current-line' : '']
          .filter(Boolean)
          .join(' ')

        return {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            glyphMarginClassName: hasBreakpoint ? 'editor-breakpoint-glyph' : undefined,
            glyphMarginHoverMessage: hasBreakpoint ? { value: `断点：第 ${line} 行` } : undefined,
            linesDecorationsClassName: isCurrentLine ? 'editor-current-line-arrows' : undefined,
            className: classNames || undefined,
          },
        }
      })

    decorationIdsRef.current = editorRef.current.deltaDecorations(decorationIdsRef.current, decorations)
  }, [activeFile, breakpointMap, debugState.currentFrame, editorReady])

  useEffect(() => {
    if (!editorReady || !editorRef.current || !activeFile) {
      return
    }

    const target = pendingEditorRevealRef.current

    if (!target || target.path !== activeFile.path) {
      return
    }

    const lineNumber = Math.max(1, target.lineNumber)
    const column = Math.max(1, target.column)
    editorRef.current.revealPositionInCenter({ lineNumber, column })
    editorRef.current.setPosition({ lineNumber, column })

    if (monacoRef.current) {
      editorRef.current.setSelection(new monacoRef.current.Range(lineNumber, column, lineNumber, column + 1))
    }

    pendingEditorRevealRef.current = null
  }, [activeFile, editorReady])

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

  function updateDebuggerPreset(value: DebuggerPreset) {
    setProfile((current) => ({ ...current, debuggerPreset: value }))
  }

  function updateDebugTargetPreset(value: DebugTargetPreset) {
    setProfile((current) => ({ ...current, debugTargetPreset: value }))
  }

  function updateDebugConfigPreset(value: DebugConfigPreset) {
    setProfile((current) => {
      if (value === 'custom') {
        return {
          ...current,
          debugConfigPreset: value,
        }
      }

      return {
        ...current,
        debugConfigPreset: value,
        ...debugConfigPresetBehaviors[value],
      }
    })
  }

  function updateDebugLaunchFlag<Key extends keyof DebugLaunchFlags>(key: Key, value: DebugLaunchFlags[Key]) {
    setProfile((current) => {
      const nextProfile = {
        ...current,
        [key]: value,
      }

      return {
        ...nextProfile,
        debugConfigPreset: inferDebugConfigPreset(nextProfile),
      }
    })
  }

  function startSidebarResize(side: ResizableSidebar, clientX: number) {
    resizeStateRef.current = {
      side,
      startX: clientX,
      startWidth: side === 'left' ? leftSidebarWidth : rightSidebarWidth,
    }
    document.body.classList.add('sidebar-resizing')
  }

  async function openDetachedPanel(kind: DetachedPanelKind) {
    await window.stm32Debug.openDetachedPanel(kind)
    setStatusText(kind === 'watch-scope' ? '已打开独立示波器窗口' : '已打开独立监视表窗口')
  }

  async function openProjectRoot() {
    const directory = await window.stm32Debug.chooseDirectory(profile.projectRoot || undefined)

    if (!directory) {
      return
    }

    const nextProfile = { ...profile, projectRoot: directory }
    setProfile(nextProfile)
    setLeftPanelView('project')
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

  function resolveProjectFileEntry(filePath: string): ProjectFileEntry {
    return (
      scanRef.current.sourceFiles.find((entry) => entry.path === filePath) ?? {
        name: filePath.split(/[\\/]/).pop() ?? filePath,
        path: filePath,
        relativePath: filePath,
        language: activeFileRef.current?.language ?? 'c',
      }
    )
  }

  async function readSourceFileCached(filePath: string) {
    const cached = sourceFileCacheRef.current.get(filePath)

    if (cached) {
      return cached
    }

    const file = await window.stm32Debug.readSourceFile(filePath)
    sourceFileCacheRef.current.set(filePath, file)
    return file
  }

  function normalizeEditorExpression(expression: string) {
    return expression
      .trim()
      .replace(/\s*(->|\.)\s*/g, '$1')
      .replace(/\s*\[\s*/g, '[')
      .replace(/\s*\]\s*/g, ']')
      .replace(/\s+/g, '')
  }

  function getEditorExpression(editor: Monaco.editor.IStandaloneCodeEditor) {
    const model = editor.getModel()

    if (!model) {
      return ''
    }

    const selection = editor.getSelection()

    if (selection && !selection.isEmpty()) {
      const selectedText = normalizeEditorExpression(model.getValueInRange(selection))

      if (selectedText && !/[\r\n]/.test(selectedText) && selectedText.length <= 160) {
        return selectedText
      }
    }

    const position = contextMenuPositionRef.current ?? editor.getPosition()

    if (!position) {
      return ''
    }

    return model.getWordAtPosition(position)?.word ?? ''
  }

  function getEditorSymbol(editor: Monaco.editor.IStandaloneCodeEditor) {
    const model = editor.getModel()
    const position = contextMenuPositionRef.current ?? editor.getPosition()

    if (!model || !position) {
      return ''
    }

    return model.getWordAtPosition(position)?.word ?? ''
  }

  async function findSymbolDefinition(symbol: string, preferredPath?: string) {
    const normalizedSymbol = symbol.trim()

    if (!normalizedSymbol) {
      return null
    }

    const escapedSymbol = escapeRegExp(normalizedSymbol)
    const patterns = [
      new RegExp(`^\\s*#\\s*define\\s+${escapedSymbol}\\b`),
      new RegExp(`^\\s*(?:struct|class|enum|union)\\s+${escapedSymbol}\\b`),
      new RegExp(`^\\s*typedef\\b.*\\b${escapedSymbol}\\b`),
      new RegExp(`^\\s*(?:template\\s*<[^>]+>\\s*)?(?:[A-Za-z_][\\w:<>~*&]*\\s+)+${escapedSymbol}\\s*\\([^;]*\\)\\s*(?:const\\b)?\\s*(?:noexcept\\b)?\\s*(?:\\{|;)?`),
      new RegExp(`^\\s*(?:extern\\s+)?(?:const\\s+|static\\s+|volatile\\s+|unsigned\\s+|signed\\s+|long\\s+|short\\s+|struct\\s+|class\\s+|enum\\s+|union\\s+|[A-Za-z_][\\w:<>~*&]*\\s+)+${escapedSymbol}\\b(?:\\s*(?:=|;|\\[|\\{|$))`),
    ]

    const preferredEntries = preferredPath ? scanRef.current.sourceFiles.filter((entry) => entry.path === preferredPath) : []
    const remainingEntries = scanRef.current.sourceFiles.filter((entry) => entry.path !== preferredPath)
    const headerEntries = remainingEntries.filter((entry) => /\.(h|hpp|hh|hxx)$/i.test(entry.name))
    const sourceEntries = remainingEntries.filter((entry) => !/\.(h|hpp|hh|hxx)$/i.test(entry.name))
    const orderedEntries = [...preferredEntries, ...headerEntries, ...sourceEntries]

    for (const entry of orderedEntries) {
      const file = await readSourceFileCached(entry.path)
      const lines = file.content.split(/\r?\n/)

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]

        if (!patterns.some((pattern) => pattern.test(line))) {
          continue
        }

        const column = Math.max(1, line.search(new RegExp(`\\b${escapedSymbol}\\b`)) + 1)

        return {
          path: entry.path,
          lineNumber: index + 1,
          column,
        }
      }
    }

    return null
  }

  async function openFile(entry: ProjectFileEntry, location?: { lineNumber: number; column?: number }) {
    const file = await readSourceFileCached(entry.path)
    setActiveFile(file)
    activeFileRef.current = file
    setActiveTab('editor')

    if (location) {
      pendingEditorRevealRef.current = {
        path: entry.path,
        lineNumber: location.lineNumber,
        column: location.column ?? 1,
      }
    }

    setStatusText(location ? `已打开 ${entry.relativePath}:${location.lineNumber}` : `已打开 ${entry.relativePath}`)
  }

  async function chooseFileForField(key: 'toolchainFile' | 'elfFile') {
    if (!profile.projectRoot) {
      setStatusText('请先选择项目目录。')
      return
    }

    const selected = await window.stm32Debug.chooseFile({
      title: key === 'toolchainFile' ? '选择 CMake 工具链文件' : '选择 ELF 文件',
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
    await withBusyState('正在执行 CMake 配置...', async () => {
      setBuildLogs([])
      const result = await window.stm32Debug.configureProject(profile)
      handleCommandResult(result, 'CMake 配置完成')
    })
  }

  async function buildProject() {
    await withBusyState('正在执行 CMake 编译...', async () => {
      const result = await window.stm32Debug.buildProject(profile)
      handleCommandResult(result, 'CMake 编译完成')
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
      setRightPanelView('watch')
      setWatchPanelView('table')
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
    await withBusyState(`调试命令: ${formatControlCommand(command)}`, async () => {
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

  async function addEditorSelectionToWatch(editor: Monaco.editor.IStandaloneCodeEditor) {
    const expression = getEditorExpression(editor)

    if (!expression) {
      setStatusText('请先在代码区选中变量或把光标放到变量上。')
      return
    }

    await addWatchExpression(expression)
    setStatusText(`已从代码区添加监视变量 ${expression}`)
  }

  async function addEditorSelectionToScope(editor: Monaco.editor.IStandaloneCodeEditor) {
    const expression = getEditorExpression(editor)

    if (!expression) {
      setStatusText('请先在代码区选中变量或把光标放到变量上。')
      return
    }

    await addScopeExpression(expression, true)
    setStatusText(`已从代码区把 ${expression} 加入示波器`)
  }

  async function goToEditorDefinition(editor: Monaco.editor.IStandaloneCodeEditor) {
    const symbol = getEditorSymbol(editor)

    if (!symbol) {
      setStatusText('当前光标位置没有可跳转的符号。')
      return
    }

    const currentPath = editor.getModel()?.uri.fsPath || activeFileRef.current?.path
    const definition = await findSymbolDefinition(symbol, currentPath)

    if (!definition) {
      setStatusText(`没有找到 ${symbol} 的定义。`)
      return
    }

    await openFile(resolveProjectFileEntry(definition.path), {
      lineNumber: definition.lineNumber,
      column: definition.column,
    })
    setStatusText(`已跳转到 ${symbol} 的定义`)
  }

  definitionLookupRef.current = findSymbolDefinition
  editorActionHandlersRef.current = {
    addToWatch: addEditorSelectionToWatch,
    addToScope: addEditorSelectionToScope,
    goToDefinition: goToEditorDefinition,
  }

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    setEditorReady(true)

    editor.onContextMenu((event) => {
      contextMenuPositionRef.current = event.target.position ?? editor.getPosition() ?? null
    })

    editor.onMouseDown((event) => {
      if (
        event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS &&
        event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
      ) {
        return
      }

      const lineNumber = event.target.position?.lineNumber

      if (!lineNumber) {
        return
      }

      void toggleBreakpoint(lineNumber)
    })

    editor.addAction({
      id: 'stm32-debug.add-watch',
      label: '添加到监视器',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.2,
      run: async () => {
        await editorActionHandlersRef.current.addToWatch(editor)
      },
    })

    editor.addAction({
      id: 'stm32-debug.add-scope',
      label: '添加到示波器',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.3,
      run: async () => {
        await editorActionHandlersRef.current.addToScope(editor)
      },
    })

    editor.addAction({
      id: 'stm32-debug.go-to-definition',
      label: '转到定义',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.1,
      keybindings: [monaco.KeyCode.F12],
      run: async () => {
        await editorActionHandlersRef.current.goToDefinition(editor)
      },
    })

    if (!editorEnhancementsRegisteredRef.current) {
      const registerDefinitionProvider = (language: 'c' | 'cpp') => {
        monaco.languages.registerDefinitionProvider(language, {
          provideDefinition: async (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
            const symbol = model.getWordAtPosition(position)?.word ?? ''

            if (!symbol) {
              return null
            }

            const definition = await definitionLookupRef.current(symbol, model.uri.fsPath || activeFileRef.current?.path)

            if (!definition) {
              return null
            }

            return {
              uri: monaco.Uri.file(definition.path),
              range: new monaco.Range(
                definition.lineNumber,
                definition.column,
                definition.lineNumber,
                definition.column + symbol.length,
              ),
            }
          },
        })
      }

      registerDefinitionProvider('c')
      registerDefinitionProvider('cpp')
      editorEnhancementsRegisteredRef.current = true
    }
  }

  async function addWatchExpression(expressionOverride = watchDraft) {
    const expression = expressionOverride.trim()

    if (!expression) {
      return
    }

    const nextExpressions = uniqueExpressions([...debugState.watches.map((entry) => entry.expression), expression])
    const state = await window.stm32Debug.setWatchExpressions(nextExpressions)
    setDebugState(state)
    setRightPanelView('watch')
    setWatchPanelView('table')
    setSelectedWatch(expression)

    if (expressionOverride === watchDraft) {
      setWatchDraft('')
    }
  }

  async function refreshWatchValues() {
    const state = await window.stm32Debug.refreshWatches()
    setDebugState(state)
    setRightPanelView('watch')
  }

  async function setScopeExpressions(expressions: string[], enabled = debugState.watchSampling.enabled, statusMessage?: string) {
    const normalizedExpressions = uniqueExpressions(expressions)
    const state = await window.stm32Debug.configureWatchSampling({
      expressions: normalizedExpressions,
      enabled: enabled && normalizedExpressions.length > 0,
      targetHz: samplingTargetHz,
    })

    setDebugState(state)
    setRightPanelView('watch')
    setWatchPanelView('scope')

    if (normalizedExpressions.length > 0) {
      const lastExpression = normalizedExpressions[normalizedExpressions.length - 1] ?? normalizedExpressions[0]
      setSelectedWatch(lastExpression)
      setScopeExpressionDraft(lastExpression)
    }

    if (statusMessage) {
      setStatusText(statusMessage)
    }

    return state
  }

  async function addScopeExpression(expression: string, ensureWatch = false) {
    const normalizedExpression = expression.trim()

    if (!normalizedExpression) {
      setStatusText('请先选择一个变量，再加入示波器。')
      return
    }

    if (ensureWatch && !debugState.watches.some((entry) => entry.expression === normalizedExpression)) {
      await addWatchExpression(normalizedExpression)
    }

    await setScopeExpressions(
      [...debugState.watchSampling.expressions, normalizedExpression],
      debugState.watchSampling.enabled,
      `已将 ${normalizedExpression} 加入示波器`,
    )
  }

  async function removeScopeExpression(expression: string) {
    const nextExpressions = debugState.watchSampling.expressions.filter((entry) => entry !== expression)

    await setScopeExpressions(
      nextExpressions,
      debugState.watchSampling.enabled,
      nextExpressions.length > 0 ? `已移除 ${expression} 示波通道` : '示波通道已清空',
    )
  }

  async function configureWatchSampling(enabled: boolean) {
    const nextExpressions = uniqueExpressions(
      debugState.watchSampling.expressions.length > 0
        ? debugState.watchSampling.expressions
        : [scopeExpressionDraft || selectedWatch],
    )

    if (enabled && nextExpressions.length === 0) {
      setStatusText('请先把变量加入示波器，再开启采样。')
      return
    }

    await withBusyState(enabled ? `开启 ${nextExpressions.length} 条曲线示波采样` : '停止示波采样', async () => {
      const state = await window.stm32Debug.configureWatchSampling({
        expressions: nextExpressions,
        enabled,
        targetHz: samplingTargetHz,
      })
      setDebugState(state)
      setRightPanelView('watch')
      setWatchPanelView('scope')
      setStatusText(
        enabled
          ? `示波器已连接 ${nextExpressions.length} 条曲线，目标频率 ${formatFrequency(state.watchSampling.targetHz)}`
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
    let state = await window.stm32Debug.setWatchExpressions(nextExpressions)

    if (scopedExpressionSet.has(expression)) {
      const nextScopeExpressions = debugState.watchSampling.expressions.filter((entry) => entry !== expression)
      state = await window.stm32Debug.configureWatchSampling({
        expressions: nextScopeExpressions,
        enabled: debugState.watchSampling.enabled && nextScopeExpressions.length > 0,
        targetHz: samplingTargetHz,
      })
    }

    setDebugState(state)

    if (selectedWatch === expression) {
      setSelectedWatch('')
      setVariableValueDraft('')
    }
  }

  async function toggleWatchExpansion(entry: WatchValue) {
    if (!entry.variableObjectName || !entry.expandable) {
      return
    }

    const state = await window.stm32Debug.setWatchExpansion({
      variableObjectName: entry.variableObjectName,
      expanded: !entry.expanded,
    })
    setDebugState(state)
    setRightPanelView('watch')
    setWatchPanelView('table')
  }

  function beginWatchEdit(entry: WatchValue) {
    if (!entry.editable || entry.error) {
      return
    }

    setSelectedWatch(entry.expression)
    setEditingWatchExpression(entry.expression)
    setVariableValueDraft(entry.value)
    setRightPanelView('watch')
    setWatchPanelView('table')
  }

  function cancelWatchEdit() {
    setEditingWatchExpression('')
    setVariableValueDraft('')
  }

  async function commitWatchEdit(expression: string) {
    if (!expression || !variableValueDraft.trim()) {
      cancelWatchEdit()
      return
    }

    setSelectedWatch(expression)
    await withBusyState(`修改变量 ${expression}`, async () => {
      const state = await window.stm32Debug.setVariable(expression, variableValueDraft.trim())
      setDebugState(state)
      setStatusText(`已写入变量 ${expression}`)
    })
    cancelWatchEdit()
  }

  function renderWatchRow(row: FlattenedWatchRow) {
    const { entry, isLast, treeContinuations } = row
    const isSelected = selectedWatch === entry.expression
    const isScoped = scopedExpressionSet.has(entry.expression)
    const scopeTrace = debugState.watchSampling.traces.find((trace) => trace.expression === entry.expression)
    const hintText = entry.error
      ? '读取失败'
      : isScoped
        ? debugState.watchSampling.active
          ? '示波采样中'
          : scopeTrace?.lastError ?? '示波已待命'
        : '点击后可编辑或加入示波器'

    const isEditing = editingWatchExpression === entry.expression
    const labelText = entry.level === 0 ? entry.expression : entry.displayName
    const nameMetaClassName = entry.level === 0 ? 'watch-name-meta root' : 'watch-name-meta'

    return (
      <tr
        key={entry.expression}
        className={isSelected ? 'watch-table-row selected' : 'watch-table-row'}
        onClick={() => {
          setSelectedWatch(entry.expression)
          setWatchPanelView('table')
        }}
      >
        <td>
          <div className="watch-name-cell" title={entry.expression}>
            <div className="watch-tree-rails" aria-hidden="true">
              {treeContinuations.slice(0, -1).map((continued, index) => (
                <span key={`${entry.expression}-guide-${index}`} className={continued ? 'watch-tree-guide continued' : 'watch-tree-guide'} />
              ))}
              {entry.level > 0 ? <span className={isLast ? 'watch-tree-branch last' : 'watch-tree-branch'} /> : null}
            </div>
            {entry.expandable ? (
              <button
                type="button"
                className={entry.expanded ? 'watch-expander expanded' : 'watch-expander'}
                onClick={(event) => {
                  event.stopPropagation()
                  void toggleWatchExpansion(entry)
                }}
              >
                {entry.expanded ? '−' : '+'}
              </button>
            ) : (
              <span className="watch-expander spacer" />
            )}
            <div className={nameMetaClassName}>
              <strong>{labelText}</strong>
              <small>{entry.type ?? hintText}</small>
            </div>
            {isScoped ? <small className="scope-chip">示波</small> : null}
          </div>
        </td>
        <td
          className={entry.editable && !entry.error ? 'watch-value-cell editable' : entry.error ? 'watch-value-cell error' : 'watch-value-cell'}
          onDoubleClick={() => beginWatchEdit(entry)}
          title={entry.error ? entry.error : entry.value}
        >
          {isEditing ? (
            <input
              autoFocus
              value={variableValueDraft}
              onChange={(event) => setVariableValueDraft(event.target.value)}
              onBlur={() => void commitWatchEdit(entry.expression)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void commitWatchEdit(entry.expression)
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelWatchEdit()
                }
              }}
            />
          ) : (
            <span>{entry.error ? `ERR: ${entry.error}` : entry.value || '-'}</span>
          )}
        </td>
      </tr>
    )
  }

  function renderWatchTableView(detached = false) {
    return (
      <div className={detached ? 'watch-tab-content detached-watch-tab-content' : 'watch-tab-content'}>
        <div className="watch-composer watch-card watch-toolbar-inline">
          <input value={watchDraft} onChange={(event) => setWatchDraft(event.target.value)} placeholder="输入变量或表达式" />
          <button onClick={() => void addWatchExpression()}>
            <ButtonLabel icon="plus" text="添加" />
          </button>
          <details className="action-menu">
            <summary>
              <ButtonLabel icon="more" text={detached ? '工具' : '更多监视'} />
            </summary>
            <div className="action-menu-list action-menu-list-inline">
              <button onClick={() => void refreshWatchValues()}>
                <ButtonLabel icon="refresh" text="刷新监视值" />
              </button>
              <button onClick={() => void addScopeExpression(selectedWatch)} disabled={!selectedWatch || detached}>
                <ButtonLabel icon="wave" text="加入示波器" />
              </button>
              {!detached ? (
                <button onClick={() => void openDetachedPanel('watch-table')}>
                  <ButtonLabel icon="popout" text="独立窗口" />
                </button>
              ) : null}
            </div>
          </details>
        </div>
        <div className="watch-table-card watch-card">
          <div className="subsection-header">
            <strong>{detached ? '独立监视表' : '监视表'}</strong>
            <span>双击值可修改，结构体/class/数组可展开</span>
          </div>
          {visibleWatchRows.length > 0 ? (
            <div className="watch-table-wrap">
              <table className="watch-table">
                <colgroup>
                  <col className="watch-name-column" />
                  <col className="watch-value-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th>变量名</th>
                    <th>值</th>
                  </tr>
                </thead>
                <tbody>{visibleWatchRows.map((entry) => renderWatchRow(entry))}</tbody>
              </table>
            </div>
          ) : (
            <div className="empty-list-state">还没有监视变量。先输入一个全局变量名，再点击“添加”。</div>
          )}
          <div className="watch-table-footer">
            <span>已选变量：{selectedWatch || '未选择'}</span>
            <button onClick={() => void removeWatch(selectedWatch)} disabled={!selectedWatch || isBusy}>
              <ButtonLabel icon="remove" text="移除当前变量" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderScopeView(detached = false) {
    return (
      <div className={detached ? 'watch-tab-content detached-watch-tab-content' : 'watch-tab-content'}>
        <div className="sampling-controls watch-card sampling-controls-wide">
          <label>
            <span>加入变量</span>
            <select value={scopeExpressionDraft} onChange={(event) => setScopeExpressionDraft(event.target.value)}>
              <option value="">请选择变量</option>
              {selectableWatchExpressions.map((entry) => (
                <option key={entry.expression} value={entry.expression}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void addScopeExpression(scopeExpressionDraft)} disabled={!scopeExpressionDraft || isBusy}>
            <ButtonLabel icon="plus" text="加入曲线" />
          </button>
          <label>
            <span>示波频率</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={samplingTargetHz}
              onChange={(event) => setSamplingTargetHz(clampSamplingHz(Number(event.target.value || '1000')))}
            />
          </label>
          <label>
            <span>时基</span>
            <select value={scopeTimebaseMs} onChange={(event) => setScopeTimebaseMs(Number(event.target.value || '1000'))}>
              {SCOPE_TIMEBASE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {formatScopeTimebase(option)}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void configureWatchSampling(true)} disabled={!debugState.watchSampling.expressions.length || isBusy}>
            <ButtonLabel icon="wave" text="开始示波" />
          </button>
          <button onClick={() => void configureWatchSampling(false)} disabled={!debugState.watchSampling.enabled || isBusy}>
            <ButtonLabel icon="stop" text="停止示波" />
          </button>
          <button onClick={() => void setScopeExpressions([], false, '示波通道已清空')} disabled={!debugState.watchSampling.expressions.length || isBusy}>
            <ButtonLabel icon="remove" text="清空曲线" />
          </button>
          {!detached ? (
            <button onClick={() => void openDetachedPanel('watch-scope')} disabled={!selectableWatchExpressions.length}>
              <ButtonLabel icon="popout" text="独立窗口" />
            </button>
          ) : null}
        </div>
        <div className="scope-channel-list watch-card">
          {scopeTraceViews.length > 0 ? (
            scopeTraceViews.map((trace) => (
              <div key={trace.expression} className="scope-channel-item" style={{ '--scope-trace-color': trace.color } as CSSProperties}>
                <div className="scope-channel-main">
                  <strong>{trace.expression}</strong>
                  <small>{trace.lastError ?? `当前值 ${trace.lastValue || formatNumericValue(trace.lastNumericValue)}`}</small>
                </div>
                <button onClick={() => void removeScopeExpression(trace.expression)} disabled={isBusy}>
                  <ButtonLabel icon="remove" text="移除" />
                </button>
              </div>
            ))
          ) : (
            <div className="empty-list-state compact-empty-state">还没有示波通道。先把监视变量加入示波器。</div>
          )}
        </div>
        <div className="scope-card scope-card-expanded">
          <div className="scope-header">
            <div>
              <h4>{detached ? '独立示波器' : '示波器'}</h4>
              <span>
                {debugState.watchSampling.expressions.length > 0
                  ? `${debugState.watchSampling.expressions.length} 条曲线 | 时基 ${formatScopeTimebase(scopeTimebaseMs)}`
                  : '未挂载变量'}
              </span>
            </div>
            <div className="scope-meta">
              <strong>{formatFrequency(debugState.watchSampling.achievedHz)}</strong>
              <small>{debugState.watchSampling.lastError ?? '支持多变量同时显示，纵轴会按当前数据自动标数值刻度'}</small>
            </div>
          </div>
          <WatchOscilloscope
            traces={scopeTraceViews}
            active={debugState.watchSampling.active}
            timebaseMs={scopeTimebaseMs}
            statusMessage={debugState.watchSampling.lastError}
          />
        </div>
      </div>
    )
  }

  const scopeModeLabel = debugState.watchSampling.active
    ? '实时'
    : debugState.watchSampling.enabled
      ? '待命'
      : '空闲'

  const workspaceStyle: CSSProperties = {
    '--left-sidebar-width': `${leftSidebarWidth}px`,
    '--right-sidebar-width': `${rightSidebarWidth}px`,
  } as CSSProperties

  if (detachedPanelMode === 'watch-table') {
    return (
      <div className="detached-panel-shell">
        <div className="detached-panel-header">
          <div>
            <p className="eyebrow">STM32 / 监视表</p>
            <h1>独立监视表</h1>
          </div>
          <div className="status-pill-group">
            <span className={debugState.connected ? 'status-pill active' : 'status-pill'}>{debugState.connected ? '已连接' : '未连接'}</span>
            <span className={debugState.running ? 'status-pill running' : 'status-pill'}>{debugState.running ? '运行中' : '已停住'}</span>
          </div>
        </div>
        {renderWatchTableView(true)}
      </div>
    )
  }

  if (detachedPanelMode === 'watch-scope') {
    return (
      <div className="detached-panel-shell detached-panel-shell-scope">
        <div className="detached-panel-header">
          <div>
            <p className="eyebrow">STM32 / 示波器</p>
            <h1>独立示波器</h1>
          </div>
          <div className="status-pill-group">
            <span className={debugState.watchSampling.active ? 'status-pill active' : 'status-pill'}>{scopeModeLabel}</span>
            <span className="status-pill">{formatFrequency(debugState.watchSampling.achievedHz)}</span>
          </div>
        </div>
        {renderScopeView(true)}
      </div>
    )
  }

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
            {debugState.connected ? '调试器已连接' : '调试器空闲'}
          </span>
          <span className={debugState.running ? 'status-pill running' : 'status-pill'}>
            {debugState.running ? '运行中' : '已停住'}
          </span>
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <h2>调试工作台</h2>
          <p>
            工程：{profile.projectRoot || '未选择'} | 接口：{debuggerPresetLabels[profile.debuggerPreset]} | 目标：{debugTargetPresetLabels[profile.debugTargetPreset]} |
            配置：{debugConfigPresetLabels[profile.debugConfigPreset]}
          </p>
        </div>
        <div className="hero-actions">
          <button onClick={() => void openProjectRoot()} disabled={isBusy}>
            <ButtonLabel icon="folder" text="选择工程" />
          </button>
          <button onClick={() => void refreshProject()} disabled={isBusy || !profile.projectRoot}>
            <ButtonLabel icon="refresh" text="扫描工程" />
          </button>
          <details className="action-menu">
            <summary>
              <ButtonLabel icon="more" text="更多工具" />
            </summary>
            <div className="action-menu-list">
              <button onClick={() => void runEnvironmentCheck()} disabled={isBusy}>
                <ButtonLabel icon="tool" text="环境自检" />
              </button>
              <button onClick={() => void generateVsCodeFiles()} disabled={isBusy || !profile.projectRoot}>
                <ButtonLabel icon="vscode" text="生成 VS Code 配置" />
              </button>
            </div>
          </details>
        </div>
      </section>

      <main className="workspace-grid" style={workspaceStyle}>
        <aside className="left-panel panel">
          <div className="panel-switcher">
            <button className={leftPanelView === 'project' ? 'active' : ''} onClick={() => setLeftPanelView('project')}>
              <ButtonLabel icon="tool" text="工程设置" />
            </button>
            <button className={leftPanelView === 'files' ? 'active' : ''} onClick={() => setLeftPanelView('files')}>
              <ButtonLabel icon="list" text="源码列表" />
            </button>
          </div>

          {leftPanelView === 'project' ? (
            <section className="panel-section form-panel">
              <div className="panel-header">
                <h3>工程设置</h3>
                <span>{scan.sourceFiles.length} 个文件</span>
              </div>

              <label>
                <span>工程目录</span>
                <input value={profile.projectRoot} onChange={(event) => updateProfile('projectRoot', event.target.value)} />
              </label>
              <div className="field-row">
                <label>
                  <span>构建目录</span>
                  <input value={profile.buildDir} onChange={(event) => updateProfile('buildDir', event.target.value)} />
                </label>
                <label>
                  <span>生成器</span>
                  <input value={profile.generator} onChange={(event) => updateProfile('generator', event.target.value)} />
                </label>
              </div>
              <div className="field-row">
                <label>
                  <span>构建类型</span>
                  <input value={profile.buildType} onChange={(event) => updateProfile('buildType', event.target.value)} />
                </label>
                <label>
                  <span>并行任务</span>
                  <input
                    type="number"
                    min={1}
                    value={profile.jobs}
                    onChange={(event) => updateProfile('jobs', Number(event.target.value || '1'))}
                  />
                </label>
              </div>
              <div className="field-row">
                <label>
                  <span>调试接口</span>
                  <select value={profile.debuggerPreset} onChange={(event) => updateDebuggerPreset(event.target.value as DebuggerPreset)}>
                    {debuggerPresetOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small className="field-hint">{debuggerPresetOptions.find((option) => option.value === profile.debuggerPreset)?.hint}</small>
                </label>
                <label>
                  <span>目标芯片 / 板卡</span>
                  <select value={profile.debugTargetPreset} onChange={(event) => updateDebugTargetPreset(event.target.value as DebugTargetPreset)}>
                    {debugTargetPresetOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small className="field-hint">{debugTargetPresetOptions.find((option) => option.value === profile.debugTargetPreset)?.hint}</small>
                </label>
              </div>
              <div className="field-row">
                <label>
                  <span>调试配置</span>
                  <select value={profile.debugConfigPreset} onChange={(event) => updateDebugConfigPreset(event.target.value as DebugConfigPreset)}>
                    {debugConfigPresetOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small className="field-hint">{debugConfigPresetOptions.find((option) => option.value === profile.debugConfigPreset)?.hint}</small>
                </label>
                <label>
                  <span>ELF 文件</span>
                  <div className="chooser-row">
                    <input value={profile.elfFile} onChange={(event) => updateProfile('elfFile', event.target.value)} />
                    <button type="button" onClick={() => void chooseFileForField('elfFile')}>
                      <ButtonLabel icon="folder" text="浏览" />
                    </button>
                  </div>
                </label>
              </div>
              <label>
                <span>工具链文件</span>
                <div className="chooser-row">
                  <input value={profile.toolchainFile} onChange={(event) => updateProfile('toolchainFile', event.target.value)} />
                  <button type="button" onClick={() => void chooseFileForField('toolchainFile')}>
                    <ButtonLabel icon="folder" text="浏览" />
                  </button>
                </div>
              </label>

              <div className="primary-action-strip compact-actions">
                <button onClick={() => void configureProject()} disabled={isBusy || !profile.projectRoot}>
                  <ButtonLabel icon="tool" text="配置工程" />
                </button>
                <button onClick={() => void buildProject()} disabled={isBusy || !profile.projectRoot}>
                  <ButtonLabel icon="refresh" text="编译工程" />
                </button>
                <button onClick={() => void startDebugSession()} disabled={isBusy || !profile.projectRoot || !profile.elfFile}>
                  <ButtonLabel icon="play" text="开始调试" />
                </button>
                <details className="action-menu">
                  <summary>
                    <ButtonLabel icon="more" text="更多操作" />
                  </summary>
                  <div className="action-menu-list">
                    <button onClick={() => void programDevice()} disabled={isBusy || !profile.projectRoot || !profile.elfFile}>
                      <ButtonLabel icon="download" text="下载程序" />
                    </button>
                    <button onClick={() => void stopDebugSession()} disabled={isBusy || !debugState.connected}>
                      <ButtonLabel icon="stop" text="停止调试" />
                    </button>
                  </div>
                </details>
              </div>

              <details className="collapse-card">
                <summary>
                  <ButtonLabel icon="tool" text="高级调试参数" />
                </summary>
                <div className="collapse-card-body">
                  <label>
                    <span>CMake 额外参数</span>
                    <input value={profile.configureArgs} onChange={(event) => updateProfile('configureArgs', event.target.value)} />
                  </label>
                  <label>
                    <span>构建目标</span>
                    <input value={profile.buildTarget} onChange={(event) => updateProfile('buildTarget', event.target.value)} />
                  </label>
                  <label>
                    <span>OpenOCD 路径</span>
                    <input value={profile.openOcdPath} onChange={(event) => updateProfile('openOcdPath', event.target.value)} />
                  </label>
                  <label>
                    <span>额外 OpenOCD 配置</span>
                    <textarea rows={3} value={profile.openOcdConfig} onChange={(event) => updateProfile('openOcdConfig', event.target.value)} />
                    <small className="field-hint">
                      {profile.debuggerPreset === 'custom' && profile.debugTargetPreset === 'custom'
                        ? '接口和目标都为自定义时，这里填写完整 OpenOCD 配置列表。'
                        : `已自动组合 ${debuggerPresetLabels[profile.debuggerPreset]} 接口和 ${debugTargetPresetLabels[profile.debugTargetPreset]} 目标配置，这里只需补额外命令或自定义覆盖。`}
                    </small>
                  </label>
                  <label>
                    <span>GDB 路径</span>
                    <input value={profile.gdbPath} onChange={(event) => updateProfile('gdbPath', event.target.value)} />
                  </label>
                  <div className="toggle-grid">
                    <label className="toggle-row">
                      <input type="checkbox" checked={profile.flashOnConnect} onChange={(event) => updateDebugLaunchFlag('flashOnConnect', event.target.checked)} />
                      <span>连接时下载 ELF</span>
                    </label>
                    <label className="toggle-row">
                      <input type="checkbox" checked={profile.resetAfterConnect} onChange={(event) => updateDebugLaunchFlag('resetAfterConnect', event.target.checked)} />
                      <span>连接后 reset halt</span>
                    </label>
                    <label className="toggle-row">
                      <input type="checkbox" checked={profile.runToMain} onChange={(event) => updateDebugLaunchFlag('runToMain', event.target.checked)} />
                      <span>自动运行到 main</span>
                    </label>
                  </div>
                </div>
              </details>

            </section>
          ) : (
            <section className="panel-section file-browser">
              <div className="panel-header">
                <h3>源码列表</h3>
                <span>{scan.cmakeListsPath ? '已识别 CMake' : '未找到 CMakeLists.txt'}</span>
              </div>
              <label>
                <span>筛选文件</span>
                <input value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} placeholder="输入文件名或相对路径" />
              </label>
              <div className="file-list">
                {filteredSourceFiles.map((entry) => (
                  <button key={entry.path} className={activeFile?.path === entry.path ? 'file-item active' : 'file-item'} onClick={() => void openFile(entry)}>
                    <span>{entry.name}</span>
                    <small>{entry.relativePath}</small>
                  </button>
                ))}
                {filteredSourceFiles.length === 0 ? <div className="empty-list-state">没有匹配的源码文件。</div> : null}
              </div>
            </section>
          )}
        </aside>

        <div className="panel-resizer" onMouseDown={(event) => startSidebarResize('left', event.clientX)} role="separator" aria-orientation="vertical" aria-label="调整左侧边栏宽度" />

        <section className="editor-panel panel">
          <div className="panel-header editor-toolbar">
            <div>
              <h3>{activeFile ? activeFile.path : '代码视图'}</h3>
              <span>{statusText}</span>
            </div>
            <div className="toolbar-buttons">
              <button onClick={() => void sendControl('continue')} disabled={!debugState.connected || isBusy}>
                <ButtonLabel icon="play" text="继续" />
              </button>
              <button onClick={() => void sendControl('pause')} disabled={!debugState.connected || isBusy}>
                <ButtonLabel icon="pause" text="暂停" />
              </button>
              <button onClick={() => void sendControl('step-over')} disabled={!debugState.connected || isBusy}>
                <ButtonLabel icon="step-over" text="越过" />
              </button>
              <details className="action-menu">
                <summary>
                  <ButtonLabel icon="more" text="更多控制" />
                </summary>
                <div className="action-menu-list action-menu-list-inline">
                  <button onClick={() => void sendControl('step-into')} disabled={!debugState.connected || isBusy}>
                    <ButtonLabel icon="step-into" text="进入" />
                  </button>
                  <button onClick={() => void sendControl('step-out')} disabled={!debugState.connected || isBusy}>
                    <ButtonLabel icon="step-out" text="跳出" />
                  </button>
                  <button onClick={() => void sendControl('reset')} disabled={!debugState.connected || isBusy}>
                    <ButtonLabel icon="reset" text="复位" />
                  </button>
                </div>
              </details>
            </div>
          </div>

          <div className="tab-strip">
            <button className={activeTab === 'editor' ? 'active' : ''} onClick={() => setActiveTab('editor')}>
              源码
            </button>
            <button className={activeTab === 'memory' ? 'active' : ''} onClick={() => setActiveTab('memory')}>
              内存预览
            </button>
            <button className={activeTab === 'registers' ? 'active' : ''} onClick={() => setActiveTab('registers')}>
              寄存器说明
            </button>
            <button className={activeTab === 'logs' ? 'active' : ''} onClick={() => setActiveTab('logs')}>
              日志
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
                  fontSize: 13,
                  lineDecorationsWidth: 18,
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
              <h3>寄存器说明</h3>
              <p>当前版本聚焦于断点、单步、调用栈与全局变量监视/修改，寄存器窗口预留给后续迭代。</p>
              <pre>{formatFrame(debugState.currentFrame)}</pre>
            </div>
          ) : null}

          {activeTab === 'logs' ? (
            <div className="log-grid">
              <section className="log-panel">
                <div className="panel-header compact">
                  <h3>构建日志</h3>
                  <span>{buildLogs.length} 条</span>
                </div>
                <pre>{buildLogText || '等待构建输出...'}</pre>
              </section>
              <section className="log-panel">
                <div className="panel-header compact">
                  <h3>调试日志</h3>
                  <span>{debugLogs.length} 条</span>
                </div>
                <pre>{debugLogText || '等待调试输出...'}</pre>
              </section>
            </div>
          ) : null}
        </section>

        <div className="panel-resizer" onMouseDown={(event) => startSidebarResize('right', event.clientX)} role="separator" aria-orientation="vertical" aria-label="调整右侧边栏宽度" />

        <aside className="right-panel panel">
          <div className="panel-switcher">
            <button className={rightPanelView === 'watch' ? 'active' : ''} onClick={() => setRightPanelView('watch')}>
              <ButtonLabel icon="wave" text="监视示波" />
            </button>
            <button className={rightPanelView === 'session' ? 'active' : ''} onClick={() => setRightPanelView('session')}>
              <ButtonLabel icon="stack" text="会话信息" />
            </button>
          </div>

          {rightPanelView === 'watch' ? (
            <section className="panel-section watch-panel">
              <div className="panel-header">
                <div>
                  <h3>监视与示波</h3>
                  <span>变量树、直接改值和示波器</span>
                </div>
                <div className="watch-badge-group">
                  <span className={debugState.watchSampling.active ? 'watch-badge live' : 'watch-badge'}>{scopeModeLabel}</span>
                  <span className="watch-badge accent">{formatFrequency(debugState.watchSampling.achievedHz)}</span>
                </div>
              </div>
              <div className="watch-summary-row">
                <span className="watch-summary-pill">示波通道：{debugState.watchSampling.expressions.length || 0}</span>
                <span className="watch-summary-pill">当前频率：{formatFrequency(debugState.watchSampling.achievedHz)}</span>
                <span className="watch-summary-pill">目标频率：{formatFrequency(debugState.watchSampling.targetHz)}</span>
                <span className="watch-summary-pill">当前时基：{formatScopeTimebase(scopeTimebaseMs)}</span>
              </div>
              <div className="mini-tab-strip">
                <button className={watchPanelView === 'table' ? 'active' : ''} onClick={() => setWatchPanelView('table')}>
                  监视表
                </button>
                <button className={watchPanelView === 'scope' ? 'active' : ''} onClick={() => setWatchPanelView('scope')}>
                  示波器
                </button>
              </div>

              {watchPanelView === 'table' ? renderWatchTableView() : null}

              {watchPanelView === 'scope' ? renderScopeView() : null}
            </section>
          ) : (
            <section className="panel-section session-panel">
              <div className="panel-header">
                <div>
                  <h3>会话信息</h3>
                  <span>{debugState.lastStopReason ?? '当前没有停止原因'}</span>
                </div>
                <span className="watch-badge">{formatSessionStatus(debugState.status)}</span>
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
                      }, frame.line ? { lineNumber: frame.line, column: 1 } : undefined)
                    }}
                  >
                    <strong>{frame.functionName}</strong>
                    <span>{frame.file ? `${frame.file}:${frame.line ?? '-'}` : frame.address ?? 'unknown'}</span>
                  </button>
                ))}
                {debugState.stack.length === 0 ? <div className="empty-list-state">当前没有可显示的调用栈。</div> : null}
              </div>
              <dl className="summary-grid">
                <div>
                  <dt>当前栈帧</dt>
                  <dd>{formatFrame(debugState.currentFrame)}</dd>
                </div>
                <div>
                  <dt>断点数</dt>
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
                  <dt>调试接口</dt>
                  <dd>{debuggerPresetLabels[profile.debuggerPreset]}</dd>
                </div>
                <div>
                  <dt>目标</dt>
                  <dd>{debugTargetPresetLabels[profile.debugTargetPreset]}</dd>
                </div>
                <div>
                  <dt>调试配置</dt>
                  <dd>{debugConfigPresetLabels[profile.debugConfigPreset]}</dd>
                </div>
                <div>
                  <dt>OpenOCD</dt>
                  <dd>{profile.openOcdPath}</dd>
                </div>
              </dl>

              <details className="collapse-card">
                <summary>
                  <ButtonLabel icon="tool" text="环境诊断" />
                </summary>
                <div className="collapse-card-body diagnostic-list">
                  {environmentCheck.tools.map((tool) => (
                    <div key={tool.command} className="diagnostic-item">
                      <div className="diagnostic-topline">
                        <strong>{tool.name}</strong>
                        <span className={tool.found ? 'diagnostic-badge ok' : 'diagnostic-badge bad'}>
                          {tool.found ? '已找到' : '缺失'}
                        </span>
                      </div>
                      <p>{tool.version ?? tool.installHint}</p>
                      <small>{tool.resolvedPath ?? tool.installHint}</small>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          )}
        </aside>
      </main>
    </div>
  )
}

export default App
