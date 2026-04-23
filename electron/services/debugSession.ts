import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import path from 'node:path'

import {
  emptyDebugSessionState,
  type CommandResult,
  type DebugBreakpoint,
  type DebugControlCommand,
  type DebugSessionState,
  type LogEvent,
  type StackFrame,
  type StartDebugRequest,
  type WatchExpansionRequest,
  type WatchSample,
  type WatchSamplingRequest,
  type WatchValue,
} from '../../src/shared/contracts'
import { parseGdbMiLine, type MiRecord, type MiValue } from './miParser'
import { createTimestamp, pathExists, resolveProjectPath, toPosixPath } from './processUtils'

type SessionEmitter = (channel: 'debug:log' | 'debug:state' | 'debug:samples', payload: unknown) => void

interface PendingCommand {
  command: string
  resolve: (payload: Record<string, MiValue>) => void
  reject: (error: Error) => void
}

function asObject(value: MiValue | undefined) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, MiValue>
  }

  return null
}

function asArray(value: MiValue | undefined) {
  return Array.isArray(value) ? value : []
}

function asString(value: MiValue | undefined) {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: MiValue | undefined) {
  const text = asString(value)

  if (!text) {
    return undefined
  }

  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeWatchChild(value: MiValue | undefined) {
  const payload = asObject(value)

  if (!payload) {
    return null
  }

  return asObject(payload.child) ?? payload
}

function cloneState(state: DebugSessionState) {
  return JSON.parse(JSON.stringify(state)) as DebugSessionState
}

function splitOpenOcdConfig(value: string) {
  return value
    .split(/[;,\r\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function quoteMiString(value: string) {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

const MAX_WATCH_SAMPLING_HZ = 1000
const WATCH_SAMPLE_BATCH_SIZE = 64
const WATCH_SAMPLE_BATCH_INTERVAL_MS = 50
const WATCH_SAMPLE_STATE_EMIT_INTERVAL_MS = 120

function clampWatchSamplingHz(value: number) {
  const normalized = Number.isFinite(value) ? Math.round(value) : MAX_WATCH_SAMPLING_HZ
  return Math.min(MAX_WATCH_SAMPLING_HZ, Math.max(1, normalized))
}

function parseWatchNumericValue(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const directHex = /^([+-])?0x([0-9a-f]+)$/i.exec(trimmed)

  if (directHex) {
    const parsed = Number.parseInt(`${directHex[1] ?? ''}${directHex[2]}`, 16)
    return Number.isFinite(parsed) ? parsed : null
  }

  const directNumber = Number(trimmed)

  if (Number.isFinite(directNumber)) {
    return directNumber
  }

  const firstToken = trimmed.match(/[+-]?0x[0-9a-f]+|[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/i)?.[0]

  if (!firstToken) {
    return null
  }

  if (/^([+-])?0x/i.test(firstToken)) {
    const hexMatch = /^([+-])?0x([0-9a-f]+)$/i.exec(firstToken)

    if (!hexMatch) {
      return null
    }

    const parsed = Number.parseInt(`${hexMatch[1] ?? ''}${hexMatch[2]}`, 16)
    return Number.isFinite(parsed) ? parsed : null
  }

  const parsed = Number(firstToken)
  return Number.isFinite(parsed) ? parsed : null
}

function joinWatchExpression(parentExpression: string, childExpression: string) {
  const trimmed = childExpression.trim()

  if (!trimmed) {
    return parentExpression
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('.') || trimmed.startsWith('->')) {
    return `${parentExpression}${trimmed}`
  }

  if (/^\d+$/.test(trimmed)) {
    return `${parentExpression}[${trimmed}]`
  }

  return `${parentExpression}.${trimmed}`
}

export class DebugSession {
  private readonly emit: SessionEmitter
  private readonly state: DebugSessionState = cloneState(emptyDebugSessionState)
  private readonly pending = new Map<string, PendingCommand>()
  private readonly promptResolvers: Array<() => void> = []

  private gdbProcess: ChildProcessWithoutNullStreams | null = null
  private openOcdProcess: ChildProcessWithoutNullStreams | null = null
  private gdbBuffer = ''
  private sequence = 1
  private watchExpressions: string[] = []
  private readonly watchRootVariableObjects = new Map<string, string>()
  private readonly watchVariableObjectByExpression = new Map<string, string>()
  private readonly expandedWatchVariableObjects = new Set<string>()
  private nextWatchObjectId = 1
  private watchSamplerTimer: NodeJS.Timeout | null = null
  private watchStateEmitTimer: NodeJS.Timeout | null = null
  private watchSamplerBusy = false
  private watchSampleBuffer: WatchSample[] = []
  private watchSampleRateWindow: number[] = []
  private lastWatchBatchEmitAt = 0

  constructor(emit: SessionEmitter) {
    this.emit = emit
  }

  private emitLog(source: LogEvent['source'], stream: LogEvent['stream'], text: string) {
    if (!text) {
      return
    }

    this.emit('debug:log', {
      source,
      stream,
      text,
      timestamp: createTimestamp(),
    } satisfies LogEvent)
  }

  private emitState() {
    this.emit('debug:state', cloneState(this.state))
  }

  private queueStateEmit(delayMs = WATCH_SAMPLE_STATE_EMIT_INTERVAL_MS) {
    if (this.watchStateEmitTimer) {
      return
    }

    this.watchStateEmitTimer = setTimeout(() => {
      this.watchStateEmitTimer = null
      this.emitState()
    }, delayMs)
  }

  private clearQueuedStateEmit() {
    if (!this.watchStateEmitTimer) {
      return
    }

    clearTimeout(this.watchStateEmitTimer)
    this.watchStateEmitTimer = null
  }

  private clearWatchSamplerTimer() {
    if (!this.watchSamplerTimer) {
      return
    }

    clearTimeout(this.watchSamplerTimer)
    this.watchSamplerTimer = null
  }

  private flushWatchSamples() {
    const expression = this.state.watchSampling.expression

    if (!expression || this.watchSampleBuffer.length === 0) {
      return
    }

    const samples = this.watchSampleBuffer.splice(0)
    this.lastWatchBatchEmitAt = Date.now()
    this.emit('debug:samples', {
      expression,
      samples,
      targetHz: this.state.watchSampling.targetHz,
      achievedHz: this.state.watchSampling.achievedHz,
    })
  }

  private pauseWatchSampling(message: string | null) {
    this.clearWatchSamplerTimer()
    this.flushWatchSamples()
    this.watchSamplerBusy = false
    this.watchSampleRateWindow = []
    this.state.watchSampling.active = false
    this.state.watchSampling.achievedHz = 0
    this.state.watchSampling.lastError = message
  }

  private resetWatchSamplingRuntime(message: string | null) {
    this.pauseWatchSampling(message)
    this.clearQueuedStateEmit()
    this.watchSampleBuffer = []
    this.lastWatchBatchEmitAt = 0
    this.state.watchSampling.sampleCount = 0
    this.state.watchSampling.lastSampleAt = null
    this.state.watchSampling.lastValue = ''
    this.state.watchSampling.lastNumericValue = null
  }

  private clearWatchVariableObjectMappings() {
    this.watchVariableObjectByExpression.clear()
  }

  private clearExpandedWatchBranch(variableObjectName: string) {
    for (const entry of [...this.expandedWatchVariableObjects]) {
      if (entry === variableObjectName || entry.startsWith(`${variableObjectName}.`)) {
        this.expandedWatchVariableObjects.delete(entry)
      }
    }
  }

  private removeWatchRootState(expression: string) {
    const variableObjectName = this.watchRootVariableObjects.get(expression)

    if (!variableObjectName) {
      return
    }

    this.watchRootVariableObjects.delete(expression)
    this.clearExpandedWatchBranch(variableObjectName)
  }

  private resetWatchObjects() {
    this.watchRootVariableObjects.clear()
    this.watchVariableObjectByExpression.clear()
    this.expandedWatchVariableObjects.clear()
    this.nextWatchObjectId = 1
  }

  private createDisconnectedWatch(expression: string): WatchValue {
    return {
      expression,
      displayName: expression,
      value: '',
      error: 'Disconnected',
      level: 0,
      expandable: false,
      expanded: false,
      editable: true,
      childCount: 0,
    }
  }

  private createWatchError(expression: string, error: string, variableObjectName?: string): WatchValue {
    return {
      expression,
      displayName: expression,
      value: '',
      error,
      level: 0,
      expandable: false,
      expanded: false,
      editable: false,
      childCount: 0,
      variableObjectName,
    }
  }

  private async ensureWatchRootVariableObject(expression: string) {
    const existing = this.watchRootVariableObjects.get(expression)

    if (existing || !this.gdbProcess) {
      return existing ?? null
    }

    const variableObjectName = `watch${this.nextWatchObjectId}`
    this.nextWatchObjectId += 1

    const payload = await this.sendCommand(`-var-create ${variableObjectName} * ${quoteMiString(expression)}`)
    const resolvedName = asString(payload.name) ?? variableObjectName
    this.watchRootVariableObjects.set(expression, resolvedName)
    return resolvedName
  }

  private async syncWatchVariableObjects() {
    const desiredExpressions = new Set(this.watchExpressions)

    for (const [expression, variableObjectName] of [...this.watchRootVariableObjects.entries()]) {
      if (desiredExpressions.has(expression)) {
        continue
      }

      if (this.gdbProcess) {
        try {
          await this.sendCommand(`-var-delete ${variableObjectName}`)
        } catch (error) {
          this.emitLog('gdb', 'stderr', `Failed to delete watch ${expression}: ${(error as Error).message}\n`)
        }
      }

      this.removeWatchRootState(expression)
    }

    for (const expression of this.watchExpressions) {
      try {
        await this.ensureWatchRootVariableObject(expression)
      } catch (error) {
        this.emitLog('gdb', 'stderr', `Failed to create watch ${expression}: ${(error as Error).message}\n`)
      }
    }
  }

  private async describeWatchVariableObject(
    variableObjectName: string,
    expression: string,
    displayName: string,
    level: number,
  ) {
    let childCount = 0
    let type: string | undefined
    let value = ''
    let error: string | undefined

    try {
      const payload = await this.sendCommand(`-var-info-num-children ${variableObjectName}`)
      childCount = asNumber(payload.numchild) ?? 0
    } catch (nextError) {
      error = (nextError as Error).message
    }

    try {
      const payload = await this.sendCommand(`-var-info-type ${variableObjectName}`)
      type = asString(payload.type)
    } catch {
      // Ignore type lookup failures and keep the watch usable.
    }

    try {
      const payload = await this.sendCommand(`-var-evaluate-expression ${variableObjectName}`)
      value = asString(payload.value) ?? ''
    } catch (nextError) {
      error = (nextError as Error).message
    }

    const watch: WatchValue = {
      expression,
      displayName,
      value,
      type,
      error,
      level,
      expandable: childCount > 0,
      expanded: this.expandedWatchVariableObjects.has(variableObjectName),
      editable: childCount === 0 && !error,
      childCount,
      variableObjectName,
    }

    this.watchVariableObjectByExpression.set(expression, variableObjectName)

    if (watch.expandable && watch.expanded) {
      watch.children = await this.listWatchChildren(variableObjectName, expression, level + 1)
    }

    return watch
  }

  private async listWatchChildren(parentVariableObjectName: string, parentExpression: string, level: number) {
    const payload = await this.sendCommand(`-var-list-children --all-values ${parentVariableObjectName}`)
    const children: WatchValue[] = []

    for (const entry of asArray(payload.children)) {
      const child = normalizeWatchChild(entry)

      if (!child) {
        continue
      }

      const variableObjectName = asString(child.name)

      if (!variableObjectName) {
        continue
      }

      const displayName = asString(child.exp) ?? variableObjectName.split('.').pop() ?? variableObjectName
      const expression = joinWatchExpression(parentExpression, displayName)
      const childCount = asNumber(child.numchild) ?? 0

      const watch: WatchValue = {
        expression,
        displayName,
        value: asString(child.value) ?? '',
        type: asString(child.type),
        error: asString(child.error),
        level,
        expandable: childCount > 0,
        expanded: this.expandedWatchVariableObjects.has(variableObjectName),
        editable: childCount === 0,
        childCount,
        variableObjectName,
      }

      this.watchVariableObjectByExpression.set(expression, variableObjectName)

      if (watch.expandable && watch.expanded) {
        watch.children = await this.listWatchChildren(variableObjectName, expression, level + 1)
      }

      children.push(watch)
    }

    return children
  }

  private findWatchByExpression(expression: string, watches = this.state.watches): WatchValue | null {
    for (const watch of watches) {
      if (watch.expression === expression) {
        return watch
      }

      const child = watch.children ? this.findWatchByExpression(expression, watch.children) : null

      if (child) {
        return child
      }
    }

    return null
  }

  private updateWatchValue(expression: string, value: string, error?: string) {
    const target = this.findWatchByExpression(expression)

    if (!target) {
      return
    }

    target.value = value
    target.error = error
  }

  private scheduleWatchSample(delayMs = 0) {
    if (!this.state.watchSampling.active || !this.state.watchSampling.expression) {
      return
    }

    this.clearWatchSamplerTimer()
    this.watchSamplerTimer = setTimeout(() => {
      this.watchSamplerTimer = null
      void this.runWatchSample()
    }, Math.max(0, delayMs))
  }

  private syncWatchSamplingState() {
    const expression = this.state.watchSampling.expression
    const hasExpression = Boolean(expression && this.watchExpressions.includes(expression))
    const shouldSample = Boolean(
      this.state.watchSampling.enabled &&
        hasExpression &&
        this.gdbProcess &&
        this.state.connected &&
        !this.state.running,
    )

    if (!shouldSample) {
      if (this.state.running) {
        this.pauseWatchSampling('目标运行中，采样已暂停')
      } else if (this.state.watchSampling.enabled && !hasExpression) {
        this.state.watchSampling.enabled = false
        this.state.watchSampling.expression = null
        this.resetWatchSamplingRuntime('采样变量已被移除')
      } else if (this.state.watchSampling.enabled && !this.gdbProcess) {
        this.pauseWatchSampling('调试器未连接')
      } else {
        this.pauseWatchSampling(this.state.watchSampling.enabled ? '等待目标停住后开始采样' : null)
      }

      return
    }

    this.state.watchSampling.active = true
    this.state.watchSampling.lastError = null

    if (!this.watchSamplerTimer && !this.watchSamplerBusy) {
      this.scheduleWatchSample()
    }
  }

  private recordWatchSampleRate(sampleTimestamp: number) {
    this.watchSampleRateWindow.push(sampleTimestamp)

    while (this.watchSampleRateWindow.length > 0 && this.watchSampleRateWindow[0] < sampleTimestamp - 1000) {
      this.watchSampleRateWindow.shift()
    }

    this.state.watchSampling.achievedHz = this.watchSampleRateWindow.length
  }

  private async runWatchSample() {
    const expression = this.state.watchSampling.expression

    if (!expression || !this.state.watchSampling.enabled) {
      return
    }

    if (!this.gdbProcess || !this.state.connected || this.state.running) {
      this.syncWatchSamplingState()
      this.queueStateEmit(0)
      return
    }

    if (this.watchSamplerBusy || this.pending.size > 0) {
      this.scheduleWatchSample(1)
      return
    }

    this.watchSamplerBusy = true
    const targetIntervalMs = 1000 / this.state.watchSampling.targetHz
    const startedAt = performance.now()

    try {
      const payload = await this.sendCommand(`-data-evaluate-expression ${quoteMiString(expression)}`)
      const value = asString(payload.value) ?? ''
      const numericValue = parseWatchNumericValue(value)
      const sampleTimestamp = Date.now()

      this.updateWatchValue(expression, value)
      this.state.watchSampling.sampleCount += 1
      this.state.watchSampling.lastSampleAt = sampleTimestamp
      this.state.watchSampling.lastValue = value
      this.state.watchSampling.lastNumericValue = numericValue
      this.state.watchSampling.lastError = numericValue === null ? '当前值不是纯数字，示波器无法绘制曲线' : null
      this.recordWatchSampleRate(sampleTimestamp)

      if (numericValue !== null) {
        this.watchSampleBuffer.push({
          timestamp: sampleTimestamp,
          value: numericValue,
        })
      }

      if (
        this.watchSampleBuffer.length >= WATCH_SAMPLE_BATCH_SIZE ||
        sampleTimestamp - this.lastWatchBatchEmitAt >= WATCH_SAMPLE_BATCH_INTERVAL_MS
      ) {
        this.flushWatchSamples()
      }

      this.queueStateEmit()
    } catch (error) {
      const message = (error as Error).message
      this.updateWatchValue(expression, '', message)
      this.state.watchSampling.lastError = message
      this.queueStateEmit(0)
    } finally {
      this.watchSamplerBusy = false

      if (!this.state.watchSampling.enabled || this.state.watchSampling.expression !== expression) {
        return
      }

      const elapsedMs = performance.now() - startedAt
      this.syncWatchSamplingState()

      if (this.state.watchSampling.active) {
        this.scheduleWatchSample(Math.max(0, targetIntervalMs - elapsedMs))
      }
    }
  }

  private resetTransientState() {
    this.state.connected = false
    this.state.running = false
    this.state.status = 'idle'
    this.state.currentFrame = null
    this.state.stack = []
    this.state.lastStopReason = null
    this.resetWatchObjects()
    this.state.watches = this.watchExpressions.map((expression) => this.createDisconnectedWatch(expression))
    this.resetWatchSamplingRuntime(this.state.watchSampling.enabled ? '调试器未连接' : null)
  }

  getState() {
    return cloneState(this.state)
  }

  private waitForPrompt(timeoutMs = 4000) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.promptResolvers.indexOf(done)

        if (index >= 0) {
          this.promptResolvers.splice(index, 1)
        }

        reject(new Error('Timed out waiting for GDB prompt.'))
      }, timeoutMs)

      const done = () => {
        clearTimeout(timer)
        resolve()
      }

      this.promptResolvers.push(done)
    })
  }

  private resolvePromptWaiters() {
    const waiters = this.promptResolvers.splice(0)

    for (const waiter of waiters) {
      waiter()
    }
  }

  private rejectPendingCommands(message: string) {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(message))
    }

    this.pending.clear()
  }

  private async startOpenOcd(request: StartDebugRequest) {
    const executable = request.openOcdPath.trim() || 'openocd'
    const configFiles = splitOpenOcdConfig(request.openOcdConfig)

    if (configFiles.length === 0) {
      throw new Error('OpenOCD config is required.')
    }

    const args = configFiles.flatMap((entry) => [
      '-f',
      resolveProjectPath(request.projectRoot, entry, entry),
    ])

    this.emitLog('openocd', 'info', `Starting OpenOCD: ${executable} ${args.join(' ')}\n`)

    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: request.projectRoot,
        windowsHide: true,
      })

      this.openOcdProcess = child
      let ready = false
      const timeout = setTimeout(() => {
        if (!ready) {
          reject(new Error('OpenOCD did not become ready on port 3333.'))
        }
      }, 12000)

      const onChunk = (stream: LogEvent['stream'], chunk: Buffer | string) => {
        const text = chunk.toString()
        this.emitLog('openocd', stream, text)

        if (!ready && /port 3333 for gdb connections|accepting 'gdb' connection/i.test(text)) {
          ready = true
          clearTimeout(timeout)
          resolve()
        }
      }

      child.stdout.on('data', (chunk) => onChunk('stdout', chunk))
      child.stderr.on('data', (chunk) => onChunk('stderr', chunk))
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)

        if (!ready) {
          reject(new Error(`OpenOCD exited before becoming ready. Exit code: ${code ?? 'unknown'}`))
          return
        }

        this.emitLog('openocd', 'info', `OpenOCD exited with code ${code ?? 'unknown'}\n`)
        this.openOcdProcess = null
      })
    })
  }

  private processGdbChunk(chunk: Buffer | string) {
    this.gdbBuffer += chunk.toString()
    const lines = this.gdbBuffer.split(/\r?\n/)
    this.gdbBuffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()

      if (!line) {
        continue
      }

      if (line === '(gdb)') {
        this.resolvePromptWaiters()
        continue
      }

      const record = parseGdbMiLine(rawLine)

      if (!record) {
        this.emitLog('gdb', 'stdout', rawLine + '\n')
        continue
      }

      void this.handleMiRecord(record)
    }
  }

  private async startGdb(request: StartDebugRequest) {
    const executable = request.gdbPath.trim() || 'arm-none-eabi-gdb'
    this.emitLog('gdb', 'info', `Starting GDB: ${executable} --quiet --interpreter=mi2\n`)

    const child = spawn(executable, ['--quiet', '--interpreter=mi2'], {
      cwd: request.projectRoot,
      windowsHide: true,
    })

    this.gdbProcess = child
    child.stdout.on('data', (chunk) => this.processGdbChunk(chunk))
    child.stderr.on('data', (chunk) => this.emitLog('gdb', 'stderr', chunk.toString()))
    child.once('error', (error) => {
      this.emitLog('gdb', 'stderr', `Failed to launch GDB: ${error.message}\n`)
    })
    child.once('exit', (code) => {
      this.emitLog('gdb', 'info', `GDB exited with code ${code ?? 'unknown'}\n`)
      this.gdbProcess = null
      this.rejectPendingCommands('GDB terminated.')
      this.resetTransientState()
      this.emitState()
    })

    await this.waitForPrompt()
  }

  private async handleMiRecord(record: MiRecord) {
    if (record.recordType === 'stream') {
      this.emitLog('gdb', record.outputType === 'log' ? 'stderr' : 'stdout', String(record.payload) + '\n')
      return
    }

    const payload = asObject(record.payload) ?? {}

    if (record.recordType === 'result') {
      if (record.token) {
        const pending = this.pending.get(record.token)

        if (pending) {
          this.pending.delete(record.token)

          if (record.className === 'error') {
            const message = asString(payload.msg) ?? `GDB command failed: ${pending.command}`
            pending.reject(new Error(message))
            return
          }

          pending.resolve(payload)
          return
        }
      }

      return
    }

    if (record.outputType === 'exec' && record.className === 'running') {
      this.state.running = true
      this.state.status = 'running'
      this.syncWatchSamplingState()
      this.emitState()
      return
    }

    if (record.outputType === 'exec' && record.className === 'stopped') {
      this.state.running = false
      this.state.status = 'halted'
      this.state.lastStopReason = asString(payload.reason) ?? 'stopped'
      const frame = this.mapFrame(payload.frame)
      this.state.currentFrame = frame
      this.pauseWatchSampling(null)
      this.emitState()
      void this.refreshStopContext()
      return
    }

    if (record.outputType === 'notify' && record.className === 'breakpoint-modified') {
      this.emitState()
    }
  }

  private mapFrame(value: MiValue | undefined): StackFrame | null {
    const payload = asObject(value)

    if (!payload) {
      return null
    }

    return {
      level: asNumber(payload.level) ?? 0,
      functionName: asString(payload.func) ?? '<unknown>',
      address: asString(payload.addr),
      file: asString(payload.file),
      fullPath: asString(payload.fullname),
      line: asNumber(payload.line),
    }
  }

  private mapBreakpoint(value: MiValue | undefined, fallbackFile: string, fallbackLine: number): DebugBreakpoint {
    const payload = asObject(value)
    const file = payload ? asString(payload.fullname) ?? asString(payload.file) ?? fallbackFile : fallbackFile

    return {
      id: payload ? asString(payload.number) ?? `${toPosixPath(fallbackFile)}:${fallbackLine}` : `${toPosixPath(fallbackFile)}:${fallbackLine}`,
      file: path.normalize(file),
      line: payload ? asNumber(payload.line) ?? fallbackLine : fallbackLine,
      enabled: payload ? (asString(payload.enabled) ?? 'y') !== 'n' : true,
      verified: Boolean(payload),
    }
  }

  private async sendCommand(command: string) {
    if (!this.gdbProcess) {
      throw new Error('GDB is not running.')
    }

    const token = String(this.sequence)
    this.sequence += 1

    return await new Promise<Record<string, MiValue>>((resolve, reject) => {
      this.pending.set(token, { command, resolve, reject })
      this.gdbProcess?.stdin.write(`${token}${command}\n`)
    })
  }

  private async sendConsoleCommand(command: string) {
    return await this.sendCommand(`-interpreter-exec console ${quoteMiString(command)}`)
  }

  private async refreshStopContext() {
    await Promise.allSettled([this.refreshStack(false), this.refreshWatches(false)])
    this.syncWatchSamplingState()
    this.emitState()
  }

  private async assertLaunchRequest(request: StartDebugRequest) {
    if (!request.projectRoot.trim()) {
      throw new Error('Project root is required.')
    }

    if (!request.elfFile.trim()) {
      throw new Error('ELF file is required.')
    }

    if (!request.openOcdConfig.trim()) {
      throw new Error('OpenOCD config is required.')
    }

    const elfFile = resolveProjectPath(request.projectRoot, request.elfFile, '')

    if (!(await pathExists(elfFile))) {
      throw new Error(`ELF file not found: ${elfFile}`)
    }
  }

  async refreshStack(emitState = true) {
    if (!this.gdbProcess) {
      return this.getState()
    }

    try {
      const payload = await this.sendCommand('-stack-list-frames')
      const stack = asArray(payload.stack)
        .map((entry) => this.mapFrame(entry))
        .filter((entry): entry is StackFrame => entry !== null)

      this.state.stack = stack

      if (stack.length > 0) {
        this.state.currentFrame = stack[0]
      }
    } catch (error) {
      this.emitLog('gdb', 'stderr', `${(error as Error).message}\n`)
    }

    if (emitState) {
      this.emitState()
    }

    return this.getState()
  }

  async refreshWatches(emitState = true) {
    if (!this.gdbProcess) {
      this.resetWatchObjects()
      this.state.watches = this.watchExpressions.map((expression) => this.createDisconnectedWatch(expression))
      this.syncWatchSamplingState()

      if (emitState) {
        this.emitState()
      }

      return this.getState()
    }

    await this.syncWatchVariableObjects()
    this.clearWatchVariableObjectMappings()

    const watches: WatchValue[] = []

    for (const expression of this.watchExpressions) {
      const variableObjectName = this.watchRootVariableObjects.get(expression)

      if (!variableObjectName) {
        watches.push(this.createWatchError(expression, '监视表达式创建失败'))
        continue
      }

      try {
        watches.push(await this.describeWatchVariableObject(variableObjectName, expression, expression, 0))
      } catch (error) {
        watches.push(this.createWatchError(expression, (error as Error).message, variableObjectName))
      }
    }

    this.state.watches = watches

    if (this.state.watchSampling.expression) {
      const sampledWatch = this.findWatchByExpression(this.state.watchSampling.expression, watches)

      if (sampledWatch) {
        this.state.watchSampling.lastValue = sampledWatch.value
        this.state.watchSampling.lastNumericValue = parseWatchNumericValue(sampledWatch.value)
        this.state.watchSampling.lastError = sampledWatch.error ?? this.state.watchSampling.lastError
      } else if (this.state.watchSampling.enabled) {
        this.state.watchSampling.enabled = false
        this.state.watchSampling.expression = null
        this.resetWatchSamplingRuntime('采样变量已不可用')
      }
    }

    this.syncWatchSamplingState()

    if (emitState) {
      this.emitState()
    }

    return this.getState()
  }

  async start(request: StartDebugRequest) {
    await this.assertLaunchRequest(request)
    await this.stop()

    this.state.status = 'connecting'
    this.emitState()

    await this.startOpenOcd(request)
    await this.startGdb(request)

    const elfFile = toPosixPath(resolveProjectPath(request.projectRoot, request.elfFile, ''))
    await this.sendCommand('-gdb-set mi-async on')
    await this.sendCommand(`-file-exec-and-symbols ${quoteMiString(elfFile)}`)
    await this.sendCommand('-target-select extended-remote localhost:3333')

    this.state.connected = true

    if (request.resetAfterConnect) {
      await this.sendConsoleCommand('monitor reset halt')
    }

    if (request.flashOnConnect) {
      await this.sendCommand('-target-download')
    }

    if (request.resetAfterConnect) {
      await this.sendConsoleCommand('monitor reset halt')
    }

    await this.syncBreakpoints()
    await this.refreshStack(false)
    await this.refreshWatches(false)

    this.state.status = 'halted'
    this.syncWatchSamplingState()
    this.emitState()

    if (request.runToMain) {
      try {
        await this.sendCommand('-break-insert -t main')
      } catch (error) {
        this.emitLog('gdb', 'stderr', `Failed to insert temporary main breakpoint: ${(error as Error).message}\n`)
      }

      await this.continueExecution()
    }

    return this.getState()
  }

  async programDevice(request: StartDebugRequest) {
    await this.assertLaunchRequest(request)
    await this.stop()

    this.state.status = 'programming'
    this.emitState()

    const elfFile = toPosixPath(resolveProjectPath(request.projectRoot, request.elfFile, ''))

    try {
      await this.startOpenOcd(request)
      await this.startGdb(request)
      await this.sendCommand('-gdb-set mi-async on')
      await this.sendCommand(`-file-exec-and-symbols ${quoteMiString(elfFile)}`)
      await this.sendCommand('-target-select extended-remote localhost:3333')
      await this.sendConsoleCommand('monitor reset halt')
      await this.sendCommand('-target-download')

      try {
        await this.sendConsoleCommand('monitor reset run')
      } catch (error) {
        this.emitLog('gdb', 'stderr', `Reset run after flash failed: ${(error as Error).message}\n`)
      }

      const stdout = `Programmed device with ${elfFile}`
      this.emitLog('app', 'info', `${stdout}\n`)

      return {
        success: true,
        exitCode: 0,
        command: 'program-device',
        stdout,
        stderr: '',
      } satisfies CommandResult
    } catch (error) {
      const message = (error as Error).message
      this.emitLog('app', 'stderr', `Programming failed: ${message}\n`)

      return {
        success: false,
        exitCode: 1,
        command: 'program-device',
        stdout: '',
        stderr: message,
      } satisfies CommandResult
    } finally {
      await this.stop()
    }
  }

  async stop() {
    this.rejectPendingCommands('Debug session stopped.')
    this.resetWatchSamplingRuntime(this.state.watchSampling.enabled ? '调试会话已停止' : null)

    if (this.gdbProcess) {
      try {
        this.gdbProcess.kill()
      } catch {
        this.emitLog('gdb', 'stderr', 'Failed to terminate GDB cleanly.\n')
      }

      this.gdbProcess = null
    }

    if (this.openOcdProcess) {
      try {
        this.openOcdProcess.kill()
      } catch {
        this.emitLog('openocd', 'stderr', 'Failed to terminate OpenOCD cleanly.\n')
      }

      this.openOcdProcess = null
    }

    this.resetTransientState()
    this.emitState()
    return this.getState()
  }

  async continueExecution() {
    await this.sendCommand('-exec-continue')
    return this.getState()
  }

  async interruptExecution() {
    await this.sendCommand('-exec-interrupt')
    return this.getState()
  }

  async stepOver() {
    await this.sendCommand('-exec-next')
    return this.getState()
  }

  async stepInto() {
    await this.sendCommand('-exec-step')
    return this.getState()
  }

  async stepOut() {
    await this.sendCommand('-exec-finish')
    return this.getState()
  }

  async resetTarget() {
    await this.sendConsoleCommand('monitor reset halt')
    await this.refreshStack(false)
    await this.refreshWatches(false)
    this.state.status = 'halted'
    this.syncWatchSamplingState()
    this.emitState()
    return this.getState()
  }

  async sendControl(command: DebugControlCommand) {
    switch (command) {
      case 'continue':
        return await this.continueExecution()
      case 'pause':
        return await this.interruptExecution()
      case 'step-over':
        return await this.stepOver()
      case 'step-into':
        return await this.stepInto()
      case 'step-out':
        return await this.stepOut()
      case 'reset':
        return await this.resetTarget()
      default:
        return this.getState()
    }
  }

  async setBreakpoints(filePath: string, lines: number[]) {
    const normalizedFile = path.normalize(filePath)
    const desiredLines = [...new Set(lines.filter((line) => line > 0))].sort((left, right) => left - right)
    const currentForFile = this.state.breakpoints.filter(
      (breakpoint) => path.normalize(breakpoint.file) === normalizedFile,
    )
    const nextBreakpoints = this.state.breakpoints.filter(
      (breakpoint) => path.normalize(breakpoint.file) !== normalizedFile,
    )

    for (const breakpoint of currentForFile) {
      if (!desiredLines.includes(breakpoint.line) && this.gdbProcess && breakpoint.verified) {
        try {
          await this.sendCommand(`-break-delete ${breakpoint.id}`)
        } catch (error) {
          this.emitLog('gdb', 'stderr', `Failed to delete breakpoint ${breakpoint.id}: ${(error as Error).message}\n`)
        }
      }
    }

    for (const line of desiredLines) {
      const existing = currentForFile.find((breakpoint) => breakpoint.line === line)

      if (existing) {
        nextBreakpoints.push(existing)
        continue
      }

      if (!this.gdbProcess) {
        nextBreakpoints.push({
          id: `${toPosixPath(normalizedFile)}:${line}`,
          file: normalizedFile,
          line,
          enabled: true,
          verified: false,
        })
        continue
      }

      try {
        const payload = await this.sendCommand(
          `-break-insert ${quoteMiString(`${toPosixPath(normalizedFile)}:${line}`)}`,
        )

        nextBreakpoints.push(this.mapBreakpoint(payload.bkpt, normalizedFile, line))
      } catch (error) {
        this.emitLog('gdb', 'stderr', `Failed to insert breakpoint ${normalizedFile}:${line}: ${(error as Error).message}\n`)
        nextBreakpoints.push({
          id: `${toPosixPath(normalizedFile)}:${line}`,
          file: normalizedFile,
          line,
          enabled: true,
          verified: false,
        })
      }
    }

    this.state.breakpoints = nextBreakpoints.sort((left, right) => {
      const fileCompare = left.file.localeCompare(right.file)
      return fileCompare !== 0 ? fileCompare : left.line - right.line
    })
    this.emitState()
    return this.getState()
  }

  private async syncBreakpoints() {
    const current = [...this.state.breakpoints]
    this.state.breakpoints = []

    for (const breakpoint of current) {
      await this.setBreakpoints(breakpoint.file, [
        ...this.state.breakpoints
          .filter((entry) => entry.file === breakpoint.file)
          .map((entry) => entry.line),
        breakpoint.line,
      ])
    }

    return this.getState()
  }

  async setWatchExpressions(expressions: string[]) {
    this.watchExpressions = [...new Set(expressions.map((expression) => expression.trim()).filter(Boolean))]

    if (
      this.state.watchSampling.expression &&
      !this.watchExpressions.some(
        (expression) =>
          this.state.watchSampling.expression === expression ||
          this.state.watchSampling.expression?.startsWith(`${expression}.`) ||
          this.state.watchSampling.expression?.startsWith(`${expression}[`),
      )
    ) {
      this.state.watchSampling.enabled = false
      this.state.watchSampling.expression = null
      this.resetWatchSamplingRuntime('采样变量已被移除')
    }

    return await this.refreshWatches()
  }

  async setWatchExpansion(request: WatchExpansionRequest) {
    if (!request.variableObjectName.trim()) {
      return this.getState()
    }

    if (request.expanded) {
      this.expandedWatchVariableObjects.add(request.variableObjectName)
    } else {
      this.clearExpandedWatchBranch(request.variableObjectName)
    }

    return await this.refreshWatches()
  }

  async configureWatchSampling(request: WatchSamplingRequest) {
    const nextExpression = request.expression?.trim() || null

    this.state.watchSampling.enabled = request.enabled && Boolean(nextExpression)
    this.state.watchSampling.expression = nextExpression
    this.state.watchSampling.targetHz = clampWatchSamplingHz(request.targetHz)
    this.state.watchSampling.maxTargetHz = MAX_WATCH_SAMPLING_HZ
    this.resetWatchSamplingRuntime(this.state.watchSampling.enabled ? '等待目标停住后开始采样' : null)
    this.syncWatchSamplingState()
    this.emitState()
    return this.getState()
  }

  async setVariable(expression: string, value: string) {
    const variableObjectName = this.watchVariableObjectByExpression.get(expression)

    if (variableObjectName) {
      await this.sendCommand(`-var-assign ${variableObjectName} ${quoteMiString(value)}`)
    } else {
      await this.sendConsoleCommand(`set var ${expression} = ${value}`)
    }

    return await this.refreshWatches()
  }
}