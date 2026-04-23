import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
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
  type WatchValue,
} from '../../src/shared/contracts'
import { parseGdbMiLine, type MiRecord, type MiValue } from './miParser'
import { createTimestamp, pathExists, resolveProjectPath, toPosixPath } from './processUtils'

type SessionEmitter = (channel: 'debug:log' | 'debug:state', payload: unknown) => void

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

  private resetTransientState() {
    this.state.connected = false
    this.state.running = false
    this.state.status = 'idle'
    this.state.currentFrame = null
    this.state.stack = []
    this.state.lastStopReason = null
    this.state.watches = this.watchExpressions.map((expression) => ({
      expression,
      value: '',
      error: 'Disconnected',
    }))
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
      this.emitState()
      return
    }

    if (record.outputType === 'exec' && record.className === 'stopped') {
      this.state.running = false
      this.state.status = 'halted'
      this.state.lastStopReason = asString(payload.reason) ?? 'stopped'
      const frame = this.mapFrame(payload.frame)
      this.state.currentFrame = frame
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
      this.state.watches = this.watchExpressions.map((expression) => ({
        expression,
        value: '',
        error: 'Disconnected',
      }))

      if (emitState) {
        this.emitState()
      }

      return this.getState()
    }

    const watches: WatchValue[] = []

    for (const expression of this.watchExpressions) {
      try {
        const payload = await this.sendCommand(`-data-evaluate-expression ${quoteMiString(expression)}`)
        watches.push({
          expression,
          value: asString(payload.value) ?? '',
        })
      } catch (error) {
        watches.push({
          expression,
          value: '',
          error: (error as Error).message,
        })
      }
    }

    this.state.watches = watches

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
    return await this.refreshWatches()
  }

  async setVariable(expression: string, value: string) {
    await this.sendConsoleCommand(`set var ${expression} = ${value}`)
    return await this.refreshWatches()
  }
}