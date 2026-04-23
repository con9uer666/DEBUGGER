import type {
  BuildProjectRequest,
  CommandResult,
  ConfigureProjectRequest,
  LogEvent,
} from '../../src/shared/contracts'
import { createTimestamp, resolveProjectPath, runCommand, splitArgs } from './processUtils'

type LogSink = (event: LogEvent) => void

function emit(log: LogSink, stream: LogEvent['stream'], text: string) {
  if (!text) {
    return
  }

  log({
    source: 'cmake',
    stream,
    text,
    timestamp: createTimestamp(),
  })
}

export async function configureProject(request: ConfigureProjectRequest, log: LogSink) {
  const cmakePath = request.cmakePath.trim() || 'cmake'
  const buildDir = resolveProjectPath(request.projectRoot, request.buildDir, 'build')
  const args = [
    '-S',
    request.projectRoot,
    '-B',
    buildDir,
    '-G',
    request.generator.trim() || 'Ninja',
    '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
  ]

  if (request.toolchainFile.trim()) {
    args.push(`-DCMAKE_TOOLCHAIN_FILE=${resolveProjectPath(request.projectRoot, request.toolchainFile, '')}`)
  }

  if (request.buildType.trim()) {
    args.push(`-DCMAKE_BUILD_TYPE=${request.buildType.trim()}`)
  }

  args.push(...splitArgs(request.configureArgs))

  emit(log, 'info', 'Running CMake configure\n')
  return await runCommand(cmakePath, args, {
    cwd: request.projectRoot,
    onStdout: (text) => emit(log, 'stdout', text),
    onStderr: (text) => emit(log, 'stderr', text),
  })
}

export async function buildProject(request: BuildProjectRequest, log: LogSink) {
  const cmakePath = request.cmakePath.trim() || 'cmake'
  const buildDir = resolveProjectPath(request.projectRoot, request.buildDir, 'build')
  const args = ['--build', buildDir]

  if (request.buildTarget.trim()) {
    args.push('--target', request.buildTarget.trim())
  }

  if (request.jobs > 0) {
    args.push('-j', String(request.jobs))
  }

  emit(log, 'info', 'Running CMake build\n')
  return await runCommand(cmakePath, args, {
    cwd: request.projectRoot,
    onStdout: (text) => emit(log, 'stdout', text),
    onStderr: (text) => emit(log, 'stderr', text),
  })
}

export type CmakeCommandResult = CommandResult