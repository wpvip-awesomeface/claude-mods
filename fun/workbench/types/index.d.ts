export type Ticket = {
  number: number
  title: string
  url: string
  repo: string
  // waiting: ready for your merge · failing: checks red · cooking: checks running or draft · merged: landed recently
  state: 'waiting' | 'failing' | 'cooking' | 'merged'
  mergedAt?: string
}

export type Pass = { tickets: Ticket[]; checkedAt: number; error?: string }

export type Meeting = {
  id: string
  title: string
  start: number
  end: number
  people: number
  // Attendee domains outside a8c.com: who the customer or partner is. Domains only, never emails.
  outside: string[]
  // Opens the event in Google Calendar.
  link?: string
}

export type Flash = { glyph: string; name: string; color: string; text: string; id: number }

// meetings: the rest of today. ahead: next business day 6am-noon, shown once today is done.
export type Day = { meetings: Meeting[]; ahead: Meeting[]; aheadDay: number; checkedAt: number; now: number; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'workbench': { pass: Pass; day: Day; nudged: string[]; isHidden: boolean; quotes: string[]; quoteHidden: boolean; fun: boolean; flash: Flash | null }
    // Owned by bento; watched here so /hush hides the Workbench too.
    'bento': { hushed: boolean }
  }
}
