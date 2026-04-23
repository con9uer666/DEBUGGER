import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  })

  if (typeof result.status === 'number') {
    return result.status
  }

  if (result.error) {
    throw result.error
  }

  return 1
}

const workspaceRoot = process.cwd()
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const electronBuilderCommand =
  process.platform === 'win32'
    ? path.join(workspaceRoot, 'node_modules', '.bin', 'electron-builder.cmd')
    : path.join(workspaceRoot, 'node_modules', '.bin', 'electron-builder')
const releaseDirectory = path.join(workspaceRoot, 'release')
const unpackedDirectory = path.join(releaseDirectory, 'win-unpacked')
const portableZipPath = path.join(releaseDirectory, 'STM32-Debug-Studio-win-unpacked.zip')

rmSync(portableZipPath, { force: true })

const buildStatus = run(npmCommand, ['run', 'build'])

if (buildStatus !== 0) {
  process.exit(buildStatus)
}

const builderStatus = run(electronBuilderCommand, ['--dir', '--win'])

if (!existsSync(unpackedDirectory)) {
  process.exit(builderStatus || 1)
}

const compressionCommand = `Compress-Archive -Path '${unpackedDirectory.replace(/\\/g, '/') }/*' -DestinationPath '${portableZipPath.replace(/\\/g, '/')}' -Force`
const compressionStatus = run('powershell', ['-NoProfile', '-Command', compressionCommand])

if (compressionStatus !== 0) {
  process.exit(compressionStatus)
}

if (builderStatus !== 0) {
  console.warn('electron-builder returned a non-zero exit code, but win-unpacked and the portable zip were generated successfully.')
}

console.log(`Portable package created: ${portableZipPath}`)