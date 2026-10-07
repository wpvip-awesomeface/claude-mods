export type Lunch = {
  startedAt: number
  turns: number
  helpers: number
  percent: number
  tokens: number
}

export type Flash = { glyph: string; name: string; color: string; text: string; id: number }

export type Warned = { context: boolean; turns: boolean }

declare module 'claude-code' {
  interface PluginState {
    bento: { lunch: Lunch; warned: Warned; isHidden: boolean; hushed: boolean; flash: Flash | null }
  }
}
