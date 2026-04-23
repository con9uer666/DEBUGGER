import { readdir } from 'node:fs/promises'
import path from 'node:path'

import type { EnvironmentCheckResult, EnvironmentToolStatus } from '../../src/shared/contracts'
import { createTimestamp, pathExists, runCommand } from './processUtils'

interface ToolDefinition {
  name: string
  command: string
  required: boolean
  versionArgs: string[]
  installHint: string
}

const toolDefinitions: ToolDefinition[] = [
  {
    name: 'CMake',
    command: 'cmake',
    required: true,
    versionArgs: ['--version'],
    installHint: '在测试机安装 CMake，并确保 cmake 已加入 PATH。',
  },
  {
    name: 'Ninja',
    command: 'ninja',
    required: false,
    versionArgs: ['--version'],
    installHint: '如果你的 STM32 项目用 Ninja 生成器，请安装 Ninja 并加入 PATH。',
  },
  {
    name: 'OpenOCD',
    command: 'openocd',
    required: true,
    versionArgs: ['--version'],
    installHint: '安装 xPack OpenOCD 或其他 OpenOCD 发行版，并确保 openocd 可直接执行。',
  },
  {
    name: 'GNU Arm GDB',
    command: 'arm-none-eabi-gdb',
    required: true,
    versionArgs: ['--version'],
    installHint: '安装 Arm GNU Toolchain，并确保 arm-none-eabi-gdb 在 PATH 中。',
  },
  {
    name: 'GNU Arm GCC',
    command: 'arm-none-eabi-gcc',
    required: true,
    versionArgs: ['--version'],
    installHint: '安装 Arm GNU Toolchain，并确保 arm-none-eabi-gcc 在 PATH 中。',
  },
  {
    name: 'Git',
    command: 'git',
    required: false,
    versionArgs: ['--version'],
    installHint: '如果需要从仓库拉取 STM32 工程，请安装 Git。',
  },
]

function normalizeFirstLine(text: string) {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean)

  return line ?? null
}

async function resolveCommand(command: string) {
  const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = await runCommand(lookupCommand, [command], {
    cwd: process.cwd(),
  })

  if (!result.success) {
    return null
  }

  return normalizeFirstLine(result.stdout)
}

async function detectTool(definition: ToolDefinition) {
  const resolvedPath = await resolveCommand(definition.command)

  if (!resolvedPath) {
    return {
      name: definition.name,
      command: definition.command,
      required: definition.required,
      found: false,
      resolvedPath: null,
      version: null,
      installHint: definition.installHint,
    } satisfies EnvironmentToolStatus
  }

  const versionResult = await runCommand(definition.command, definition.versionArgs, {
    cwd: process.cwd(),
  })
  const version = normalizeFirstLine(versionResult.stdout) ?? normalizeFirstLine(versionResult.stderr)

  return {
    name: definition.name,
    command: definition.command,
    required: definition.required,
    found: true,
    resolvedPath,
    version,
    installHint: definition.installHint,
  } satisfies EnvironmentToolStatus
}

export async function checkHostEnvironment() {
  const tools = await Promise.all(toolDefinitions.map((definition) => detectTool(definition)))

  return {
    checkedAt: createTimestamp(),
    ready: tools.every((tool) => !tool.required || tool.found),
    tools,
  } satisfies EnvironmentCheckResult
}

export async function listReleaseArtifacts(releaseDirectory: string) {
  if (!(await pathExists(releaseDirectory))) {
    return []
  }

  const entries = await readdir(releaseDirectory, { withFileTypes: true })
  return entries
    .map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      fullPath: path.join(releaseDirectory, entry.name),
    }))
    .filter((entry) => entry.isDirectory || /\.(exe|msi|zip|7z)$/i.test(entry.name))
}