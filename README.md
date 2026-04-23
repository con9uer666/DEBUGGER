# STM32 Debug Studio

STM32 Debug Studio is a Windows desktop debugging workbench for STM32 projects that use CMake, OpenOCD or DAPLink-compatible probes, and the GNU Arm toolchain.

The current version is implemented with Electron, React, TypeScript, Monaco Editor, OpenOCD, and GDB/MI. It is designed to give you a Keil-like desktop workflow around source browsing, breakpoints, stepping, build orchestration, call stack inspection, and global variable watch or modification.

## Chinese Guide

- 详细中文使用教程见 [docs/使用教程.md](docs/使用教程.md)

## Current Capabilities

- Open an STM32 project root and scan CMake-based source trees
- Configure and build STM32 projects by invoking CMake directly
- Generate VS Code tasks, launch, and settings files for Cortex-Debug workflows
- Launch OpenOCD and arm-none-eabi-gdb from the desktop UI
- Start a debug session, halt, continue, step over, step into, step out, and reset
- Program an ELF directly to the target board without entering a full debug session
- Toggle source breakpoints directly from the editor gutter
- Inspect call stack frames after halts
- Watch global expressions and write new values through GDB
- View separate build and debug logs inside the application
- Run host-environment diagnostics to check whether CMake, OpenOCD, GDB, and related tools are available

## Current Gaps Relative to Full Keil Parity

The foundation is in place, but this is not yet a full Keil replacement. The following areas are not fully implemented in the current revision:

- Peripheral register views
- Raw memory-by-address inspection and editing
- Register window with live CPU core register decoding
- SWV, RTT, ITM, semihosting integration panels
- RTOS-aware thread inspection
- SVD-driven peripheral visualization
- Flash algorithm customization and advanced erase/program options
- Multi-core and multi-target session management

## Host Environment Installed On This Machine

The following host tools were installed or verified during setup:

- Node.js LTS
- Git
- CMake
- Ninja
- xPack OpenOCD
- Arm GNU Toolchain
- VS Code extensions: C/C++, CMake Tools, Cortex-Debug, clangd

## Development Commands

- Install dependencies: `npm.cmd install`
- Build the desktop app: `npm.cmd run build`
- Run the built desktop app: `npm.cmd start`
- Start renderer plus Electron for development: `npm.cmd run dev`
- Build a portable test package: `npm.cmd run dist`
- Build a Windows installer: `npm.cmd run dist:installer`

`npm.cmd run dist` creates a portable zip package under `release/STM32-Debug-Studio-win-unpacked.zip`, which is the easiest artifact to copy to another Windows PC for testing.

## Testing On Another PC

1. On the current machine, run `npm.cmd run dist`.
2. Copy one of the following to the other Windows PC:
  - `release/STM32-Debug-Studio-win-unpacked.zip`
  - or, if you prefer an installer, generate one with `npm.cmd run dist:installer`
3. On the other PC, install or provide these host tools:
  - CMake
  - OpenOCD
  - Arm GNU Toolchain
  - optionally Ninja if your CMake project uses it
4. Open your STM32 project in VS Code and build it with CMake so that an ELF file is generated.
5. Launch STM32 Debug Studio on that PC.
6. Use `环境自检` to verify the machine can find CMake, OpenOCD, GDB, and GCC.
7. Select the STM32 project root, set the OpenOCD config and ELF path, then use:
  - `Program Device` to only download firmware to the board
  - `Start Debug` to download and enter the debug session

If `flashOnConnect` is enabled, `Start Debug` will also download the ELF into the target before the debugging session continues.

## How To Use The Tool

1. Launch the application.
2. Select the STM32 project root.
3. Fill in the build profile:
   - CMake generator
   - build directory
   - toolchain file
   - OpenOCD config file list
   - GDB path
   - ELF path
4. Run Configure and Build.
5. Press Start Debug.
6. Click the editor gutter to add or remove breakpoints.
7. Use Continue, Pause, Step Over, Step Into, Step Out, and Reset.
8. Add watch expressions and use Write Variable to modify values.
9. Use Generate VS Code Config to create .vscode/tasks.json, .vscode/launch.json, and .vscode/settings.json for the selected target project.
10. Use Program Device when you only want to flash the board and start the firmware without staying in a debug session.

## Project Structure

- `electron/`
  Main process, preload bridge, CMake service, project scanning, and GDB/OpenOCD session management.
- `src/`
  Renderer UI and workbench layout.
- `src/shared/`
  IPC contracts and shared types between Electron and the renderer.

## Notes For STM32 Projects

- `OpenOCD Config` accepts one or more config files separated by semicolons or new lines.
- `ELF File` should point to the actual debug output from your STM32 build.
- `Toolchain File` should reference your ARM embedded CMake toolchain description.
- Use `Debug` builds so symbols are preserved and stepping behaves correctly.

## Validation Status

Validated in this workspace:

- `npm.cmd install`
- `npm.cmd run build`
- `npm.cmd start`

The application now builds successfully and starts without immediate Electron runtime errors.
