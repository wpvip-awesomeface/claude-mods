export type Timing = { tail: string; ms: number }

declare module 'claude-code' {
  interface PluginState {
    'turn-timer': { times: Timing[] }
  }
}
