export type Card = { shape: string; reason: string; why: 'extract' | 'fresh'; at: number }

declare module 'claude-code' {
  interface PluginState {
    'recipe-card': { card: Card | null; saved: number; isHidden: boolean }
    // Owned by turn-timer; read here to draw the time above the route line.
    'turn-timer': { times: { tail: string; ms: number }[] }
    // Owned by bento; watched here so /hush hides the card too.
    'bento': { hushed: boolean }
  }
}
