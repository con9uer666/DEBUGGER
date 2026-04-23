# STM32 Debug Studio Workspace Notes

- This workspace builds a Windows desktop STM32 debugging tool with Electron, React, and TypeScript.
- Keep main-process code under `electron/` and renderer code under `src/`.
- Keep IPC contracts in `src/shared/contracts.ts` and update both preload and renderer when contracts change.
- Prefer focused changes that preserve CMake invocation, OpenOCD launch flow, and GDB/MI session handling.
- Validate significant changes with `npm.cmd run build` on Windows.