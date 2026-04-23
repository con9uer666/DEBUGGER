import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'

import type { CommandResult } from '../../src/shared/contracts'

export interface RunCommandOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export function createTimestamp() {
  return new Date().toISOString()
}

export function formatCommand(command: string, args: string[]) {
  return [command, ...args].join(' ')
}

export function resolveProjectPath(projectRoot: string, filePath: string, fallback: string) {
  const candidate = filePath.trim() || fallback

  if (path.isAbsolute(candidate)) {
    return path.normalize(candidate)
  }

  return path.join(projectRoot, candidate)
}

export function toPosixPath(filePath: string) {
  return filePath.replace(/\\/g, '/')
}

export function splitArgs(value: string) {
  const result: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]

    if (character === '\\' && index + 1 < value.length) {
      current += value[index + 1]
      index += 1
      continue
    }

    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double'
      continue
    }

    if (character === '\'' && quote !== 'double') {
      quote = quote === 'single' ? null : 'single'
      continue
    }

    if (/\s/.test(character) && quote === null) {
      if (current) {
        result.push(current)
        current = ''
      }

      continue
    }

    current += character
  }

  if (current) {
    result.push(current)
  }

  return result
}

export function getLanguageFromPath(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.c':
      return 'c'
    case '.cpp':
    case '.cc':
    case '.cxx':
    case '.hpp':
    case '.hh':
    case '.hxx':
      return 'cpp'
    case '.h':
      return 'c'
    case '.cmake':
      return 'cmake'
    case '.json':
      return 'json'
    case '.md':
      return 'markdown'
    default:
      return 'plaintext'
  }
}

export async function pathExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export function toWorkspacePath(projectRoot: string, filePath: string) {
  const relativePath = path.relative(projectRoot, filePath)

  if (!relativePath || relativePath.startsWith('..')) {
    return toPosixPath(filePath)
  }

  return relativePath ? '${workspaceFolder}/' + toPosixPath(relativePath) : '${workspaceFolder}'
}

export function normalizeUserPath(value: string) {
  return path.normalize(value).replace(/[\\/]+$/, '')
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
) {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString()
      stdout += text
      options.onStdout?.(text)
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString()
      stderr += text
      options.onStderr?.(text)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (exitCode) => {
      resolve({
        success: exitCode === 0,
        exitCode,
        command: formatCommand(command, args),
        stdout,
        stderr,
      })
    })
  })
}