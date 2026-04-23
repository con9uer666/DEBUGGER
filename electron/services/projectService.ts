import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  OpenFileResult,
  ProjectFileEntry,
  ProjectProfile,
  ProjectScanResult,
  VsCodeGenerationResult,
} from '../../src/shared/contracts'
import {
  getLanguageFromPath,
  normalizeUserPath,
  resolveProjectPath,
  toWorkspacePath,
} from './processUtils'

const sourceExtensions = new Set([
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.hh',
  '.hxx',
  '.ld',
  '.s',
  '.S',
  '.cmake',
  '.txt',
])

const ignoredDirectories = new Set([
  '.git',
  '.vs',
  '.vscode',
  'node_modules',
  '.settings',
  '.idea',
])

function compareEntries(left: ProjectFileEntry, right: ProjectFileEntry) {
  return left.relativePath.localeCompare(right.relativePath)
}

export async function scanProject(projectRoot: string, buildDir?: string) {
  const normalizedRoot = normalizeUserPath(projectRoot)
  const normalizedBuildDir = buildDir ? normalizeUserPath(resolveProjectPath(projectRoot, buildDir, 'build')) : null
  const sourceFiles: ProjectFileEntry[] = []
  let cmakeListsPath: string | null = null

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue
        }

        if (normalizedBuildDir && normalizeUserPath(fullPath) === normalizedBuildDir) {
          continue
        }

        await walk(fullPath)
        continue
      }

      if (entry.name === 'CMakeLists.txt' && cmakeListsPath === null) {
        cmakeListsPath = fullPath
      }

      if (!sourceExtensions.has(path.extname(entry.name))) {
        continue
      }

      sourceFiles.push({
        name: entry.name,
        path: fullPath,
        relativePath: path.relative(normalizedRoot, fullPath).replace(/\\/g, '/'),
        language: getLanguageFromPath(fullPath),
      })
    }
  }

  await walk(normalizedRoot)
  sourceFiles.sort(compareEntries)

  return {
    projectRoot: normalizedRoot,
    cmakeListsPath,
    sourceFiles,
  } satisfies ProjectScanResult
}

export async function readSourceFile(filePath: string) {
  const content = await readFile(filePath, 'utf8')

  return {
    path: filePath,
    language: getLanguageFromPath(filePath),
    content,
  } satisfies OpenFileResult
}

function splitOpenOcdConfig(openOcdConfig: string) {
  return openOcdConfig
    .split(/[;,\r\n]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

export async function generateVsCodeFiles(profile: ProjectProfile) {
  const vscodeDirectory = path.join(profile.projectRoot, '.vscode')
  await mkdir(vscodeDirectory, { recursive: true })

  const buildDir = resolveProjectPath(profile.projectRoot, profile.buildDir, 'build')
  const toolchainFile = profile.toolchainFile.trim()
    ? resolveProjectPath(profile.projectRoot, profile.toolchainFile, '')
    : ''
  const elfFile = resolveProjectPath(profile.projectRoot, profile.elfFile, '')
  const openOcdFiles = splitOpenOcdConfig(profile.openOcdConfig).map((entry) =>
    toWorkspacePath(profile.projectRoot, resolveProjectPath(profile.projectRoot, entry, entry)),
  )

  const configureArgs = [
    '-S',
    '${workspaceFolder}',
    '-B',
    toWorkspacePath(profile.projectRoot, buildDir),
    '-G',
    profile.generator || 'Ninja',
    '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
  ]

  if (toolchainFile) {
    configureArgs.push(`-DCMAKE_TOOLCHAIN_FILE=${toWorkspacePath(profile.projectRoot, toolchainFile)}`)
  }

  if (profile.buildType) {
    configureArgs.push(`-DCMAKE_BUILD_TYPE=${profile.buildType}`)
  }

  if (profile.configureArgs.trim()) {
    configureArgs.push(profile.configureArgs.trim())
  }

  const buildArgs = ['--build', toWorkspacePath(profile.projectRoot, buildDir)]

  if (profile.buildTarget.trim()) {
    buildArgs.push('--target', profile.buildTarget.trim())
  }

  if (profile.jobs > 0) {
    buildArgs.push('-j', String(profile.jobs))
  }

  const tasks = {
    version: '2.0.0',
    tasks: [
      {
        label: 'STM32 CMake Configure',
        type: 'shell',
        command: profile.cmakePath || 'cmake',
        args: configureArgs,
        options: {
          cwd: '${workspaceFolder}',
        },
        problemMatcher: [],
      },
      {
        label: 'STM32 CMake Build',
        type: 'shell',
        command: profile.cmakePath || 'cmake',
        args: buildArgs,
        options: {
          cwd: '${workspaceFolder}',
        },
        group: {
          kind: 'build',
          isDefault: true,
        },
        dependsOn: 'STM32 CMake Configure',
        problemMatcher: ['$gcc'],
      },
    ],
  }

  const launch = {
    version: '0.2.0',
    configurations: [
      {
        name: 'STM32 OpenOCD Debug',
        type: 'cortex-debug',
        request: 'launch',
        cwd: '${workspaceFolder}',
        servertype: 'openocd',
        gdbPath: profile.gdbPath || 'arm-none-eabi-gdb',
        executable: toWorkspacePath(profile.projectRoot, elfFile),
        configFiles: openOcdFiles,
        runToEntryPoint: profile.runToMain ? 'main' : undefined,
        preLaunchTask: 'STM32 CMake Build',
        showDevDebugOutput: 'raw',
      },
    ],
  }

  const settings = {
    'cmake.sourceDirectory': '${workspaceFolder}',
    'cmake.buildDirectory': toWorkspacePath(profile.projectRoot, buildDir),
    'cmake.generator': profile.generator || 'Ninja',
    'cmake.configureOnOpen': false,
  }

  const tasksPath = path.join(vscodeDirectory, 'tasks.json')
  const launchPath = path.join(vscodeDirectory, 'launch.json')
  const settingsPath = path.join(vscodeDirectory, 'settings.json')

  await writeFile(tasksPath, JSON.stringify(tasks, null, 2) + '\n', 'utf8')
  await writeFile(launchPath, JSON.stringify(launch, null, 2) + '\n', 'utf8')
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')

  return {
    tasksPath,
    launchPath,
    settingsPath,
  } satisfies VsCodeGenerationResult
}