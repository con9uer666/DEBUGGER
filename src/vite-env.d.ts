/// <reference types="vite/client" />

import type { Stm32DebugApi } from './shared/contracts'

declare global {
  interface Window {
    stm32Debug: Stm32DebugApi
  }
}

export {}