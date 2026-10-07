import { atom, read, update } from 'claude-code'
import type { EngineInterface as Dollar, Register } from 'claude-code'

import type { Day, Meeting, Pass, Ticket } from '../types'

// Muted Dracula accents for the names, greys for everything else (matches bento).
const GREG = '#A393C7'
const LINK = '#C3B3EC' // a step brighter than greg's name, for PR titles
const BIRDY = '#7FB2C0'
const TEXT = '#D4D4D4'
const DATA = '#A3A3A3'
const MUTED = '#6B6B6B' // quiet footnotes: the quote toggle, "checked …"
const LINKY = '#CFC98A' // muted Dracula yellow, for the linkydoos header

// ── linkydoos: one-click links to each demo's site, repo and open PRs ─────────
const GH = 'https://github.com/wpcomvip/'
const LINKYDOOS = [
  { name: 'vip demo', site: 'https://wpvipdemo.dev/', repo: 'vip-soleng-vip-demo' },
  { name: 'federal gov', site: 'https://wpvipgov.com/', repo: 'vip-soleng-us-federal-government-showme' },
  { name: 'publisher', site: 'https://vip-news.digital/', repo: 'vip-soleng-publisher-demo' },
]

const PANE = 'workbench'
const TITLE = 'Workbench'

const pass = atom({ plugin: 'workbench', key: 'pass' } as const, { tickets: [], checkedAt: 0 })
const day = atom({ plugin: 'workbench', key: 'day' } as const, { meetings: [], ahead: [], aheadDay: 0, checkedAt: 0, now: 0 })
const nudged = atom({ plugin: 'workbench', key: 'nudged' } as const, [])
const quotes = atom({ plugin: 'workbench', key: 'quotes' } as const, [])
// Hide the quote for recordings and screenshares; sticks until you show it again.
const quoteHidden = atom({ plugin: 'workbench', key: 'quoteHidden' } as const, false)
// A colored notice above the prompt, in place of plain toasts (toasts can't take color).
const flash = atom({ plugin: 'workbench', key: 'flash' } as const, null)
// Survives hot reloads, so hiding the Workbench sticks until you show it again.
const isHidden = atom({ plugin: 'workbench', key: 'isHidden' } as const, false)
// Fun mode: the quote, pizza and mochi. Off by default; /fun flips it and the
// choice is kept in $.store, so it stays put across sessions until flipped again.
const fun = atom({ plugin: 'workbench', key: 'fun' } as const, false)
const FUN_KEY = 'funMode'

const FLASH_MS = 10_000

// Shows a notice in the speaker's color for a few seconds; a newer one replaces it.
const say = async ($: Dollar, who: 'greg' | 'birdy', text: string) => {
  const id = await $.clock.now()
  const voice = who === 'greg' ? { glyph: '▤', name: 'greg', color: GREG } : { glyph: '◷', name: 'birdy', color: BIRDY }
  await update($, flash, () => ({ ...voice, text, id }))
  $.clock.after(FLASH_MS, () => void update($, flash, f => (f && f.id === id ? null : f)))
}

// ── greg: the pass ────────────────────────────────────────────────────────────

const GREG_EVERY_MS = 3 * 60 * 1000
const MERGED_WINDOW_MS = 3 * 60 * 60 * 1000

const QUERY = `query($open: String!, $merged: String!) {
  open: search(query: $open, type: ISSUE, first: 20) { nodes { ...pr } }
  merged: search(query: $merged, type: ISSUE, first: 10) { nodes { ...pr } }
}
fragment pr on PullRequest {
  number title url isDraft mergedAt
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`

type PrNode = {
  number: number
  title: string
  url: string
  isDraft: boolean
  mergedAt: string | null
  repository: { nameWithOwner: string }
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
}

const toTicket = (n: PrNode, merged: boolean): Ticket => {
  const checks = n.commits.nodes[0]?.commit.statusCheckRollup?.state
  const state: Ticket['state'] = merged ? 'merged'
    : checks === 'FAILURE' || checks === 'ERROR' ? 'failing'
    : n.isDraft || checks === 'PENDING' || checks === 'EXPECTED' ? 'cooking'
    : 'waiting'

  return { number: n.number, title: n.title, url: n.url, repo: n.repository.nameWithOwner, state, mergedAt: n.mergedAt ?? undefined }
}

const checkPass = async ($: Dollar) => {
  const now = await $.clock.now()
  const since = new Date(now - MERGED_WINDOW_MS).toISOString().slice(0, 19)

  try {
    const ran = await $.process.run([
      'gh', 'api', 'graphql',
      '-f', `query=${QUERY}`,
      '-f', 'open=is:pr is:open author:@me archived:false',
      '-f', `merged=is:pr is:merged author:@me merged:>=${since}`,
    ], { timeoutMs: 20000 })

    if (ran.exitCode !== 0) {
      await update($, pass, p => ({ ...p, checkedAt: now, error: 'gh could not reach GitHub' }))
      return
    }

    const data = JSON.parse(ran.stdout).data
    const tickets: Ticket[] = [
      ...data.open.nodes.filter((n: PrNode) => n.number).map((n: PrNode) => toTicket(n, false)),
      ...data.merged.nodes.filter((n: PrNode) => n.number).map((n: PrNode) => toTicket(n, true)),
    ]

    const before = await read($, pass)
    const was = new Map(before.tickets.map(t => [t.url, t.state]))

    // Speak up only when something changes state, and only after the first look.
    if (before.checkedAt > 0) {
      for (const t of tickets) {
        const old = was.get(t.url)
        if (t.state === 'merged' && old !== 'merged') {
          await say($, 'greg', `#${t.number} merged. Deploy runs from GitHub; content changes next.`)
        } else if (t.state === 'failing' && old !== 'failing') {
          await say($, 'greg', `checks failing on #${t.number} ${t.title}`)
        } else if (t.state === 'waiting' && old && old !== 'waiting') {
          await say($, 'greg', `#${t.number} is green and waiting on your merge`)
        }
      }
    }

    await update($, pass, () => ({ tickets, checkedAt: now }))
  } catch {
    await update($, pass, p => ({ ...p, checkedAt: now, error: 'gh is not available' }))
  }
}

// ── birdy: mise en place ──────────────────────────────────────────────────────

// The Google Calendar connector's list tool as last seen; findCalendarTool looks up the live name.
const CALENDAR_TOOL = 'mcp__b181ff40-d5f0-44e8-b7fc-66208918b06e__list_events'
const HOME_DOMAIN = 'a8c.com'
const BIRDY_EVERY_MS = 5 * 60 * 1000
const NUDGE_MS = 10 * 60 * 1000

type Attendee = { email?: string; self?: boolean; responseStatus?: string }
type CalEvent = {
  id: string
  summary?: string
  status?: string
  eventType?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  htmlLink?: string
  attendees?: Attendee[]
}

const toMeeting = (ev: CalEvent): Meeting | null => {
  if (ev.status === 'cancelled' || ev.eventType !== 'DEFAULT') return null
  if (!ev.start?.dateTime || !ev.end?.dateTime) return null // all-day

  const people = ev.attendees ?? []
  if (people.some(a => a.self && a.responseStatus === 'declined')) return null
  if (people.length < 2) return null // solo blocks are focus time, not meetings

  const outside = [...new Set(
    people
      .map(a => a.email?.split('@')[1]?.toLowerCase())
      .filter((d): d is string => !!d && d !== HOME_DOMAIN && !d.endsWith('calendar.google.com')),
  )]

  return {
    id: ev.id,
    title: ev.summary ?? 'Untitled meeting',
    start: Date.parse(ev.start.dateTime),
    end: Date.parse(ev.end.dateTime),
    people: people.length,
    outside,
    // Google Calendar's own page for the event; only kept when it is a plain https link.
    link: ev.htmlLink?.startsWith('https://') ? ev.htmlLink : undefined,
  }
}

// The connector's tool name carries an id that can differ between sessions, so look it up:
// any MCP tool named ..._list_events that describes itself as a calendar.
// Any connected calendar's list_events: same schema, so typed as the one we know.
type McpToolName = typeof CALENDAR_TOOL

const findCalendarTool = async ($: Dollar): Promise<McpToolName | null> => {
  const tools = await $.tool.list()
  const hit = tools.find(t => t.mcp && t.name.endsWith('__list_events') && /calendar/i.test(t.description))
  return (hit?.name as McpToolName | undefined) ?? (tools.some(t => t.name === CALENDAR_TOOL) ? CALENDAR_TOOL : null)
}

// Local midnight at the start of the given day.
const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Midnight of the next weekday (Fri, Sat, Sun all look ahead to Monday). Holidays are not skipped.
const nextBusinessDay = (ms: number) => {
  const d = new Date(startOfDay(ms))
  do d.setDate(d.getDate() + 1)
  while (d.getDay() === 0 || d.getDay() === 6)
  return d.getTime()
}

// Midnight at the end of the given day (DST-safe: steps the calendar date, not 24h).
const endOfDay = (ms: number) => {
  const d = new Date(startOfDay(ms))
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

const atHour = (dayStart: number, hour: number) => {
  const d = new Date(dayStart)
  d.setHours(hour)
  return d.getTime()
}

const RETRY_MS = 30_000
const RETRIES = 6
let retriesLeft = RETRIES

const checkDay = async ($: Dollar) => {
  const now = await $.clock.now()
  const fail = async (error: string) => {
    await update($, day, d => ({ ...d, checkedAt: now, now, error }))
    // Connectors often finish connecting after the session starts: try again soon, a few times.
    if (retriesLeft > 0) {
      retriesLeft -= 1
      $.clock.after(RETRY_MS, () => void checkDay($))
    }
  }

  try {
    const tool = await findCalendarTool($)
    if (!tool) return fail('calendar connector not connected yet')

    const list = async (from: number, to: number) => {
      const ran = await $.tool.call({
        tool,
        startTime: new Date(from).toISOString(),
        endTime: new Date(to).toISOString(),
        orderBy: 'startTime',
        pageSize: 25,
      })
      if (ran.deny) throw new Error('calendar access was blocked by a permission rule')
      if (ran.isError || !ran.text) throw new Error('calendar connector returned an error')
      const events: CalEvent[] = JSON.parse(ran.text).events ?? []
      return events.map(toMeeting).filter((m): m is Meeting => !!m)
    }

    // The rest of today, then the next business morning (6am-noon) as a look ahead.
    const aheadDay = nextBusinessDay(now)
    const meetings = await list(now - 60 * 60 * 1000, endOfDay(now))
    const ahead = (await list(atHour(aheadDay, 6), atHour(aheadDay, 12))).filter(m => m.start >= atHour(aheadDay, 6))
    retriesLeft = RETRIES
    await update($, day, () => ({ meetings, ahead, aheadDay, checkedAt: now, now }))
  } catch (err) {
    await fail(err instanceof Error && err.message.startsWith('calendar') ? err.message : 'calendar is not reachable')
  }
}

// Each minute: move the clock (redraws the countdown) and nudge once before a meeting.
const tick = async ($: Dollar) => {
  const now = await $.clock.now()
  const d = await update($, day, x => ({ ...x, now }))
  const soon = d.meetings.find(m => m.start > now && m.start - now <= NUDGE_MS)
  if (!soon) return

  const done = await read($, nudged)
  if (done.includes(soon.id)) return

  await update($, nudged, list => [...list, soon.id].slice(-50))
  const mins = Math.max(1, Math.round((soon.start - now) / 60000))
  await say($, 'birdy', `${soon.title} in ${mins}m. /prep to get ready.`)
}

const pick = (d: Day) => ({
  current: d.meetings.find(m => m.start <= d.now && m.end > d.now),
  upcoming: d.meetings.filter(m => m.start > d.now),
})

const prepPrompt = (m: Meeting, now = Date.now()) => [
  `Prep me for my next meeting: "${m.title}" at ${clock(m.start)}${m.start >= endOfDay(now) ? ` on ${weekday(m.start)}` : ''}`,
  `with ${m.people} people${m.outside.length ? ` (outside: ${m.outside.join(', ')})` : ' (internal)'}.`,
  'Look up the event description and any linked docs, related PRs I have open or merged recently,',
  'and demo pages on wpvipdemo.dev that fit. Give me a short checklist: what to open, what to show, what to ask.',
  'Do not change anything, just prep.',
].join(' ')

// Opens a PR in the browser. Only GitHub PR URLs from greg's own query get through.
const openPr = async ($: Dollar, url: string) => {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)) return
  await $.process.run(['open', url], { timeoutMs: 5000 })
}

const show = async ($: Dollar) => {
  await update($, isHidden, () => false)
  await $.ui.open({ id: PANE, title: TITLE })
}

// ── quote of the day ──────────────────────────────────────────────────────────

// The one quote list every session reads: paste lines or a whole paragraph, # for comments.
// Relative to $HOME, so the mod works on any machine.
const QUOTES_PATH = '.claude/mods/fun/workbench/assets/quotes.txt'
const QUOTE_COLOR = '#F2F2F0'
const QUOTE_FONT = "Helvetica, 'Helvetica Neue', Arial, sans-serif"

// Built-in list, used when assets/quotes.txt is missing or unreadable.
const DEFAULT_QUOTES = [
  "Ship the ugly first draft.",
  "Make the fucking thing.",
  "Show it, don't explain it.",
  "Cut it in half. Then again.",
  "Done beats perfect.",
  "Ask the dumb question.",
  "Talk less. Ship more.",
  "Test it your damn self.",
  "Steal the pattern, not the work.",
  "Clarity is a kindness.",
  "Defaults are decisions.",
  "If it needs a manual, fix it.",
  "Name things like you mean it.",
  "Make it fucking obvious.",
  "Delete more than you add.",
  "Prototype before you pitch.",
  "Every click costs something.",
  "The demo is the argument.",
  "Sweat the first five seconds.",
  "Small, sharp, shipped.",
  "Write it down or it didn't happen.",
  "Make the next step obvious.",
  "Leave it better than you found it.",
  "Trust the user. Test the assumption.",
  "Good enough, then great.",
]

const loadQuotes = async ($: Dollar) => {
  try {
    // Read through the shell: the mod's own file access is limited to the session's folder.
    const ran = await $.process.run(['sh', '-c', `cat "$HOME/${QUOTES_PATH}"`], { timeoutMs: 5000 })
    if (ran.exitCode !== 0) throw new Error('unreadable')
    const text = ran.stdout
    // Paste-friendly: lines are joined, then split into sentences, so a pasted paragraph works.
    const list = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .join(' ').split(/(?<=[.!?])\s+/).map(q => q.trim()).filter(Boolean)
    await update($, quotes, () => list)
  } catch {
    await update($, quotes, () => [])
  }
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

// Today's pick. Stepping by a number coprime with the list length walks every quote
// before repeating, and two days in a row never land on the same one.
const quoteFor = (list: string[], now: number) => {
  if (list.length === 0) return null
  const dayNumber = Math.floor((now - new Date(now).getTimezoneOffset() * 60000) / 86400000)
  let step = 7
  while (gcd(step, list.length) !== 1) step += 1
  return list[(dayNumber * step) % list.length]
}

const escapeXml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Breaks a quote into lines of at most `max` characters, on word boundaries.
const wrap = (t: string, max: number) => {
  const lines: string[] = []
  let line = ''
  for (const word of t.split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

// Big, bold, nearly-white type in the poster's spirit, drawn as SVG text so it scales.
const quoteSvg = (t: string) => {
  // Twice the old 30px. Long words shrink the type just enough to fit the 300-wide box
  // (bold Helvetica runs about 0.52em per character).
  const lines = wrap(t, 10)
  const longest = Math.max(...lines.map(l => l.length))
  const size = Math.min(60, Math.floor(300 / (longest * 0.52)))
  const lead = Math.round(size * 1.08)
  const height = lines.length * lead + 8
  const tspans = lines.map((l, i) => `<tspan x="0" y="${size + i * lead}">${escapeXml(l)}</tspan>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${height}" viewBox="0 0 300 ${height}"><text font-family="${QUOTE_FONT}" font-weight="700" font-size="${size}" letter-spacing="-1" fill="${QUOTE_COLOR}">${tspans}</text></svg>`
}

// ── mochi: a chunky 8-bit dino, standing tall and grinning ────────────────────

// One character per pixel: . empty, G body, D brow/shade, L belly, S spikes, W teeth, K mouth, E eyes.
// No outline: bright shapes straight on the pane.
const MOCHI = [
  '....DDDDDDD.............',
  '...DGGGGGGGD............',
  '..GGEGGGGEGGG...........',
  '.GGGGGGGGGGGGG..........',
  '.GKGGGGGGGGKGGS.........',
  '.GGKWWWWWWKGGGG.........',
  '..GGKKKKKKGGGGS.........',
  '...GGGGGGGGGGGG.........',
  '....DGGGGGGGGS..........',
  '....GGLLLLGGGGS.........',
  '...GGGLLLLGGGGGS........',
  '.GGGGGLLLLLGGGGGS.......',
  'GG..GGLLLLLGGGGGGS..G...',
  '....GGLLLLLGGGGGGGS.G...',
  '....GGLLLLLLGGGGGGGGG...',
  '....GGLLLLLLGGGGGGGS....',
  '....GGGLLLLLGGGGGGGGS...',
  '....GGGGGGGGGGGGGGGGGS..',
  '....GGGG....GGGGGGGGGGS.',
  '....GGG......GGG...GGGGS',
  '....GGG......GGG.....GGG',
  '...GGGG.....GGGG........',
]

// Bright retro palette: mint body, lime belly, aqua spikes, a big cheesy grin, tiny black eyes.
const MOCHI_COLORS: Record<string, string> = {
  G: '#4FD08A',
  D: '#2E9E68',
  L: '#B6F28C',
  S: '#7FE3E0',
  W: '#FFFFFF',
  K: '#1B2420',
  E: '#111111',
}

const mochiSvg = () => {
  const px = 4
  const w = (MOCHI[0] ?? '').length * px
  const h = MOCHI.length * px
  const cells = (keep: (c: string) => boolean) =>
    MOCHI.flatMap((row, y) =>
      [...row].map((c, x) => (c !== '.' && keep(c)
        ? `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${MOCHI_COLORS[c]}"/>`
        : '')),
    ).join('')

  const body = cells(c => c !== 'S')
  const spikes = cells(c => c === 'S')
  // A blink is a body-colored lid over the eye for a moment, every few seconds.
  const blink = '<animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.92;0.96;1" dur="4s" repeatCount="indefinite"/>'
  const lid = [4, 9].map(x => `<rect x="${x * px}" y="${2 * px}" width="${px}" height="${px}" fill="${MOCHI_COLORS.G}" opacity="0">${blink}</rect>`).join('')

  // Room around mochi to jump, spin and flip without clipping.
  const padX = 32
  const padTop = 48
  const W = w + padX * 2
  const H = padTop + h + px
  const cx = padX + w / 2
  const cy = padTop + h / 2
  const feet = H
  const { tx, ty, r, s, dur } = mochiDance()

  const anim = (type: string, values: string) =>
    `<animateTransform attributeName="transform" type="${type}" values="${values}" keyTimes="${tx.keyTimes}" dur="${dur}s" repeatCount="indefinite"/>`

  // Nested groups: hop/slide, then spin around the middle, then squash/flip from the feet.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">`
    + `<g>${anim('translate', tx.values.map((x, i) => `${x} ${ty.values[i]}`).join(';'))}`
    + `<g>${anim('rotate', r.values.map(a => `${a} ${cx} ${cy}`).join(';'))}`
    + `<g transform="translate(${cx} ${feet})"><g>${anim('scale', s.values.join(';'))}<g transform="translate(${-cx} ${-feet})">`
    + `<g transform="translate(${padX} ${padTop})">`
    + `<g><animateTransform attributeName="transform" type="translate" values="0 ${px};0 0;0 ${px}" dur="1.6s" calcMode="discrete" repeatCount="indefinite"/>`
    + body + lid
    + `<g>${spikes}<animate attributeName="opacity" values="1;0.55;1" dur="2.4s" calcMode="discrete" repeatCount="indefinite"/></g>`
    + '</g></g></g></g></g></g></g></svg>'
}

// ── mochi's dance moves: a random routine, picked fresh each time the mod loads ──

type Pose = { tx: number; ty: number; r: number; sx: number; sy: number }
// Each step: seconds to get there, and the pose reached (unset fields are at rest; r is relative to the move's start).
type Move = Array<[number, Partial<Pose>]>

const MOVES: Record<string, Move> = {
  bounce: [
    [0.12, { sx: 1.15, sy: 0.85 }], [0.25, { ty: -28, sx: 0.92, sy: 1.08 }], [0.25, { sx: 1.12, sy: 0.88 }], [0.1, {}],
    [0.22, { ty: -18, sx: 0.94, sy: 1.06 }], [0.22, { sx: 1.1, sy: 0.9 }], [0.12, {}],
  ],
  dance: [
    [0.22, { tx: -8, ty: -4, r: -12 }], [0.22, { tx: 8, ty: -4, r: 12 }], [0.22, { tx: -8, ty: -4, r: -12 }],
    [0.22, { tx: 8, ty: -4, r: 12 }], [0.22, { tx: -8, ty: -4, r: -12 }], [0.22, { tx: 8, ty: -4, r: 12 }], [0.2, {}],
  ],
  spin: [
    [0.12, { sx: 1.1, sy: 0.9 }], [0.6, { ty: -12, r: 360 }], [0.14, { r: 360, sx: 1.1, sy: 0.9 }], [0.1, { r: 360 }],
  ],
  backflip: [
    [0.15, { sx: 1.15, sy: 0.85 }], [0.32, { ty: -38, r: -180, sx: 0.95, sy: 1.05 }], [0.32, { r: -360 }],
    [0.12, { r: -360, sx: 1.14, sy: 0.86 }], [0.12, { r: -360 }],
  ],
  turnaround: [
    [0.18, { sx: -1 }], [0.15, { sx: -1, ty: -8 }], [0.15, { sx: -1 }], [0.15, { sx: -1, ty: -8 }], [0.15, { sx: -1 }], [0.18, {}],
  ],
  shimmy: [
    [0.07, { tx: -4 }], [0.07, { tx: 4 }], [0.07, { tx: -4 }], [0.07, { tx: 4 }],
    [0.07, { tx: -4 }], [0.07, { tx: 4 }], [0.07, { tx: -4 }], [0.07, { tx: 4 }], [0.07, {}],
  ],
}

const mochiDance = () => {
  const names = Object.keys(MOVES)
  const rest: Pose = { tx: 0, ty: 0, r: 0, sx: 1, sy: 1 }
  const frames: Array<[number, Pose]> = [[0, rest]]
  let t = 0
  let base = 0
  let last = ''
  const hold = (secs: number) => {
    t += secs
    frames.push([t, { ...rest, r: base }])
  }

  hold(0.8 + Math.random())
  for (let i = 0; i < 12; i++) {
    let name: string
    do name = names[Math.floor(Math.random() * names.length)]!
    while (name === last)
    last = name
    for (const [dt, pose] of MOVES[name]!) {
      t += dt
      frames.push([t, { ...rest, ...pose, r: base + (pose.r ?? 0) }])
    }
    base = frames[frames.length - 1]![1].r
    hold(0.6 + Math.random() * 2)
  }

  // Whole turns look the same, so the loop can jump back to 0° unseen.
  const keyTimes = frames.map(([at], i) => (i === frames.length - 1 ? '1' : (at / t).toFixed(4))).join(';')
  const pick = (f: (p: Pose) => string | number) => ({ keyTimes, values: frames.map(([, p]) => f(p)) })
  return {
    dur: t.toFixed(2),
    tx: pick(p => p.tx),
    ty: pick(p => p.ty),
    r: pick(p => p.r),
    s: pick(p => `${p.sx} ${p.sy}`),
  }
}

// Built once per load, so redraws don't restart the routine.
const MOCHI_SVG = mochiSvg()

// ── pizza: a dripping pepperoni slice, side view, ringed by muted code glyphs ───────────────────────────

// Bright slice, slate-grey glyphs, one blinking text cursor. No background.
// The slice floats; its cheese drips stretch a touch as it rises. The code symbols stay put.
const PIZZA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220" viewBox="0 0 300 220"><g font-family="Menlo, Monaco, monospace" font-weight="700"><text x="14" y="38" font-size="24" fill="#555E73">{ }</text><text x="232" y="30" font-size="20" fill="#4B5366">&lt;/&gt;</text><text x="16" y="110" font-size="18" fill="#606A80">#</text><text x="250" y="140" font-size="24" fill="#555E73">;</text><text x="226" y="196" font-size="18" fill="#4B5366">$_</text><text x="120" y="212" font-size="16" fill="#606A80">=&gt;</text><text x="18" y="200" font-size="16" fill="#555E73">[ ]</text></g><rect x="276" y="96" width="3" height="18" fill="#606A80"><animate attributeName="opacity" values="1;1;0;0" dur="1.1s" repeatCount="indefinite"/></rect><path d="M86 26 l0 24 l6 -5 l5 10 l4 -2 l-5 -10 l8 0 z" fill="#606A80"/><g><path d="M248 98 L60 158 L60 168 L250 110 Z" fill="#E3A35A"/><path d="M138 44 Q200 58 250 96 L58 158 Q92 98 138 44 Z" fill="#FFD23F"/><path d="M120 70 q30 6 50 18 M90 118 q40 -8 70 -4" stroke="#F4B728" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.7"/><g fill="#FFC93C"><path d="M58 152 L250 92 L250 100 Q200 116 150 128 Q100 142 60 160 Z"/><path d="M76 140 h10 v48 a5.0 5.0 0 0 1 -10 0 "><animate attributeName="d" values="M76 140 h10 v48.00 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v48.27 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v49.00 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v50.00 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v51.00 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v51.73 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v52.00 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v51.73 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v51.00 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v50.00 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v49.00 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v48.27 a5.0 5.0 0 0 1 -10 0 ;M76 140 h10 v48.00 a5.0 5.0 0 0 1 -10 0 " dur="3.6s" repeatCount="indefinite" keyTimes="0;0.0833;0.1667;0.25;0.3333;0.4167;0.5;0.5833;0.6667;0.75;0.8333;0.9167;1"/></path><path d="M96 133 h9 v61 a4.5 4.5 0 0 1 -9 0 "><animate attributeName="d" values="M96 133 h9 v61.00 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v61.27 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v62.00 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v63.00 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v64.00 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v64.73 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v65.00 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v64.73 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v64.00 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v63.00 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v62.00 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v61.27 a4.5 4.5 0 0 1 -9 0 ;M96 133 h9 v61.00 a4.5 4.5 0 0 1 -9 0 " dur="3.6s" repeatCount="indefinite" keyTimes="0;0.0833;0.1667;0.25;0.3333;0.4167;0.5;0.5833;0.6667;0.75;0.8333;0.9167;1"/></path><path d="M140 119 h8 v39 a4.0 4.0 0 0 1 -8 0 "><animate attributeName="d" values="M140 119 h8 v39.00 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v39.27 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v40.00 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v41.00 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v42.00 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v42.73 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v43.00 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v42.73 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v42.00 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v41.00 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v40.00 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v39.27 a4.0 4.0 0 0 1 -8 0 ;M140 119 h8 v39.00 a4.0 4.0 0 0 1 -8 0 " dur="3.6s" repeatCount="indefinite" keyTimes="0;0.0833;0.1667;0.25;0.3333;0.4167;0.5;0.5833;0.6667;0.75;0.8333;0.9167;1"/></path><path d="M186 104 h9 v54 a4.5 4.5 0 0 1 -9 0 "><animate attributeName="d" values="M186 104 h9 v54.00 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v54.27 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v55.00 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v56.00 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v57.00 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v57.73 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v58.00 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v57.73 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v57.00 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v56.00 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v55.00 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v54.27 a4.5 4.5 0 0 1 -9 0 ;M186 104 h9 v54.00 a4.5 4.5 0 0 1 -9 0 " dur="3.6s" repeatCount="indefinite" keyTimes="0;0.0833;0.1667;0.25;0.3333;0.4167;0.5;0.5833;0.6667;0.75;0.8333;0.9167;1"/></path><path d="M228 91 h7 v35 a3.5 3.5 0 0 1 -7 0 "><animate attributeName="d" values="M228 91 h7 v35.00 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v35.27 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v36.00 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v37.00 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v38.00 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v38.73 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v39.00 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v38.73 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v38.00 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v37.00 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v36.00 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v35.27 a3.5 3.5 0 0 1 -7 0 ;M228 91 h7 v35.00 a3.5 3.5 0 0 1 -7 0 " dur="3.6s" repeatCount="indefinite" keyTimes="0;0.0833;0.1667;0.25;0.3333;0.4167;0.5;0.5833;0.6667;0.75;0.8333;0.9167;1"/></path></g><g fill="#E8404F"><ellipse cx="160" cy="74" rx="13" ry="8" transform="rotate(20 160 74)"/><ellipse cx="205" cy="92" rx="12" ry="7.5" transform="rotate(20 205 92)"/><ellipse cx="128" cy="96" rx="12" ry="7.5" transform="rotate(20 128 96)"/><ellipse cx="160" cy="114" rx="11" ry="7" transform="rotate(20 160 114)"/><ellipse cx="96" cy="128" rx="10" ry="6.5" transform="rotate(20 96 128)"/></g><g fill="#FF8A93"><ellipse cx="156" cy="72" rx="4" ry="2.5" transform="rotate(20 156 72)"/><ellipse cx="201" cy="90" rx="4" ry="2.5" transform="rotate(20 201 90)"/><ellipse cx="124" cy="94" rx="4" ry="2.5" transform="rotate(20 124 94)"/></g><path d="M136 46 Q200 56 252 98" stroke="#D98A3D" stroke-width="22" fill="none" stroke-linecap="round"/><path d="M138 40 Q198 50 250 90" stroke="#F0AE5E" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M170 46 q6 6 0 12 M206 60 q6 6 0 12 M234 78 q6 6 -1 12" stroke="#C97A30" stroke-width="2.5" fill="none" stroke-linecap="round"/><animateTransform attributeName="transform" type="translate" values="0 2.00;0 1.46;0 0.00;0 -2.00;0 -4.00;0 -5.46;0 -6.00;0 -5.46;0 -4.00;0 -2.00;0 0.00;0 1.46;0 2.00" dur="3.6s" repeatCount="indefinite" keyTimes="0;0.0833;0.1667;0.25;0.3333;0.4167;0.5;0.5833;0.6667;0.75;0.8333;0.9167;1"/></g></svg>'

// A line of small UI type, drawn as SVG since Text has no size.
const smallText = (t: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="16" viewBox="0 0 240 16"><text x="0" y="12" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, sans-serif" font-size="11" fill="${color}">${escapeXml(t)}</text></svg>`

// ── shared formatting ─────────────────────────────────────────────────────────

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const weekday = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: 'long' })

const until = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t)

const GROUPS: { state: Ticket['state']; label: string }[] = [
  { state: 'failing', label: 'checks failing' },
  { state: 'waiting', label: 'waiting on your merge' },
  { state: 'cooking', label: 'cooking' },
]

// ── wiring ────────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'workbench', description: 'Show or hide the Workbench side pane (greg & birdy)' })
    await $.command.register({ name: 'greg', description: 'Show the Workbench side pane' })
    await $.command.register({ name: 'birdy', description: 'Show the Workbench side pane' })
    await $.command.register({ name: 'greg-check', description: 'Have greg and birdy check right now' })
    await $.command.register({ name: 'quotes', description: 'Open the Workbench quote list to edit (paste text, one sentence each)' })
    await $.command.register({ name: 'prep', description: 'Birdy preps you for your next meeting' })
    await $.command.register({ name: 'fun', description: 'Fun mode on or off: quote, pizza and mochi (stays until you flip it)' })

    const savedFun = (await $.store.get(FUN_KEY)) === true
    await update($, fun, () => savedFun)

    void loadQuotes($)
    void checkPass($)
    void checkDay($)
    $.clock.every(GREG_EVERY_MS, () => void checkPass($))
    $.clock.every(BIRDY_EVERY_MS, () => void checkDay($))
    $.clock.every(60 * 1000, () => void tick($))
    if (!(await read($, isHidden))) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  // /hush (owned by bento) hides the Workbench; /hush again brings it back.
  on('state.set', { plugin: 'bento', key: 'hushed' }, async ($, e, next) => {
    const result = await next(e)
    if (e.value) {
      await update($, isHidden, () => true)
      await $.ui.close({ id: PANE })
    } else {
      await show($)
    }
    return result
  }).catch(($, e, next) => next(e)) // a failed hide never blocks /hush itself

  // Closing the pane yourself counts as hiding it; greg and birdy keep checking either way.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isHidden, () => true)
    return next(e)
  }).catch(($, e, next) => next(e)) // the pane still closes if remembering that fails

  for (const command of ['greg', 'birdy']) {
    on('command.run', { command }, async $ => {
      await show($)
      return { text: 'Workbench is open.' }
    })
  }

  on('command.run', { command: 'workbench' }, async $ => {
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (!isOpen) {
      await show($)
      return { text: 'Workbench is open.' }
    }

    await update($, isHidden, () => true)
    await $.ui.close({ id: PANE })
    return { text: 'Workbench tucked away. /workbench brings it back.' }
  })

  // /fun flips it; /fun on and /fun off set it outright.
  on('command.run', { command: 'fun' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isFun = await update($, fun, was => (arg === 'on' ? true : arg === 'off' ? false : !was))
    await $.store.set(FUN_KEY, isFun)
    return { text: isFun ? 'Fun mode on: quote, pizza and mochi are back. Stays on until /fun again.' : 'Fun mode off: quote, pizza and mochi hidden. Stays off until /fun again.' }
  })

  on('command.run', { command: 'greg-check' }, async $ => {
    await Promise.all([checkPass($), checkDay($)])
    return { text: 'Greg and birdy checked in.' }
  })

  on('command.run', { command: 'quotes' }, async $ => {
    const opened = await $.process.run(['sh', '-c', `open -t "$HOME/${QUOTES_PATH}"`], { timeoutMs: 5000 })
    await loadQuotes($)
    return { text: opened.exitCode === 0 ? 'Opened your quote list in TextEdit. Save it, then run /quotes again to reload.' : `Could not open ~/${QUOTES_PATH}` }
  })

  on('command.run', { command: 'prep' }, async $ => {
    await checkDay($)
    const d = await read($, day)
    const { current, upcoming } = pick(d)
    const m = upcoming[0] ?? current ?? (d.ahead ?? [])[0]
    if (!m) return { text: 'Birdy sees no more meetings today or next morning.' }

    void $.prompt.submit({ text: prepPrompt(m, d.now) })
    return { text: `Birdy is prepping you for ${m.title}…` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, flash)
    if (e.props.hasSurvey || !f) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text>
            <Text bold color={f.color}>{f.glyph} {f.name} </Text>
            <Text color={TEXT}>{f.text}</Text>
          </Text>
          <Button key="flash-close" plain dimColor label="×" onPress={() => update($, flash, () => null)} />
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const p = await read($, pass)
    const d = await read($, day)
    const loaded = await read($, quotes)
    const list = loaded.length ? loaded : DEFAULT_QUOTES
    const isQuoteHidden = await read($, quoteHidden)
    const isFun = await read($, fun)
    const quote = quoteFor(list, d.now || p.checkedAt || Date.now())
    const width = Math.max(24, (e.props.bodyColumns ?? e.viewport?.columns ?? 48) - 2)
    const dot = <Text color={DATA}> · </Text>

    // birdy
    const { current, upcoming } = pick(d)
    const next = upcoming[0]
    const later = upcoming.slice(1, 6)
    // Older saved state from before the look ahead existed has no ahead list.
    const ahead = d.ahead ?? []
    const firstAhead = ahead[0]
    const who = (m: Meeting) => (m.outside.length ? m.outside.slice(0, 2).join(', ') : 'internal')

    const birdy = (
      <Box flexDirection="column">
        <Text bold color={BIRDY}>◷ birdy</Text>
        {d.checkedAt === 0 && <Text color={DATA}>looking at your calendar…</Text>}
        {d.error && <Text color={TEXT}>{d.error}</Text>}
        {!d.error && current && (
          <Text>
            <Text color={TEXT}>now </Text>
            {current.link ? <Link href={current.link}><Text color={TEXT}>{cut(current.title, width - 18)}</Text></Link> : <Text color={TEXT}>{cut(current.title, width - 18)}</Text>}
            {dot}<Text color={DATA}>ends in {until(current.end - d.now)}</Text>
          </Text>
        )}
        {!d.error && next && (
          <Box flexDirection="column">
            <Text>
              <Text color={TEXT}>next </Text>
              {next.link ? <Link href={next.link}><Text bold color={TEXT}>{cut(next.title, width - 16)}</Text></Link> : <Text bold color={TEXT}>{cut(next.title, width - 16)}</Text>}
            </Text>
            <Text>
              <Text color={DATA}>in {until(next.start - d.now)}</Text>
              {dot}<Text color={DATA}>{clock(next.start)}</Text>
              {dot}<Text color={DATA}>{next.people}</Text><Text color={TEXT}> people</Text>
              {dot}<Text color={DATA}>{who(next)}</Text>
            </Text>
            <Box>
              <Button key="prep" label="Prep me" onPress={() => void $.prompt.submit({ text: prepPrompt(next, d.now) })} />
            </Box>
          </Box>
        )}
        {!d.error && d.checkedAt > 0 && !current && !next && (
          <Box flexDirection="column">
            <Text bold color={TEXT}>No More Meetings</Text>
            <Text color={DATA}> </Text>
            <Text color={DATA}>look ahead · {weekday(d.aheadDay)} morning</Text>
            {ahead.length === 0 && <Text color={TEXT}>nothing before noon, cook away</Text>}
            {ahead.map(m => (
              <Text>
                <Text color={DATA}>{clock(m.start).padEnd(8)} </Text>
                {m.link ? <Link href={m.link}><Text color={TEXT}>{cut(m.title, width - 10)}</Text></Link> : <Text color={TEXT}>{cut(m.title, width - 10)}</Text>}
                {dot}<Text color={DATA}>{who(m)}</Text>
              </Text>
            ))}
            {firstAhead && (
              <Box>
                <Button key="prep-ahead" label="Prep me" onPress={() => void $.prompt.submit({ text: prepPrompt(firstAhead, d.now) })} />
              </Box>
            )}
          </Box>
        )}
        {later.length > 0 && <Text color={DATA}> </Text>}
        {later.map(m => (
          <Text>
            <Text color={DATA}>{clock(m.start).padEnd(8)} </Text>
            {m.link ? <Link href={m.link}><Text color={TEXT}>{cut(m.title, width - 10)}</Text></Link> : <Text color={TEXT}>{cut(m.title, width - 10)}</Text>}
          </Text>
        ))}
      </Box>
    )

    // greg
    const greg = (
      <Box flexDirection="column">
        <Text bold color={GREG}>▤ greg</Text>
        {p.checkedAt === 0 && <Text color={DATA}>checking the pass…</Text>}
        {p.error && <Text color={TEXT}>{p.error}</Text>}
        {!p.error && p.checkedAt > 0 && p.tickets.every(t => t.state === 'merged') && <Text color={TEXT}>everything is merged and good!</Text>}
        {!p.error && GROUPS.map(g => {
          const list = p.tickets.filter(t => t.state === g.state)
          if (list.length === 0) return null

          return (
            <Box flexDirection="column" marginTop={1}>
              <Text><Text color={TEXT}>{g.label} </Text><Text color={DATA}>{list.length}</Text></Text>
              {list.slice(0, 6).map(t => (
                <Box flexDirection="column">
                  <Box key={`pr-${t.repo}-${t.number}`} gap={1}>
                    {/* A Link takes styled children, so the lavender title itself opens the PR.
                        The app draws its own (blue) hover underline; mods can't restyle it. */}
                    <Link href={t.url}><Text color={LINK}>#{t.number} {cut(t.title, width - 10)}</Text></Link>
                    <Button plain label="↗" hover={{ color: LINK }} onPress={() => void openPr($, t.url)} />
                  </Box>
                  <Text color={DATA}>  {t.repo.split('/')[1]}{t.mergedAt ? ` · ${ago(d.now - Date.parse(t.mergedAt))}` : ''}</Text>
                </Box>
              ))}
            </Box>
          )
        })}
        {p.checkedAt > 0 && (e.surface === 'terminal'
          ? <Text color={MUTED}>✓ checked {ago((d.now || p.checkedAt) - p.checkedAt)}</Text>
          : (() => {
              // Small type sits snug under the list, so it reads as part of greg.
              const { Svg } = $.ui.resolve(e)
              const label = `✓ checked ${ago((d.now || p.checkedAt) - p.checkedAt)}`
              return <Svg source={smallText(label, MUTED)} alt={label} />
            })())}
      </Box>
    )

    const toggleQuote = (
      // Buttons can't take a text color, so the words are muted Text and the glyph is the click target.
      <Box key="quote-toggle" gap={1}>
        <Button
          plain
          dimColor
          label={isQuoteHidden ? '+' : '−'}
          hover={{ color: DATA }}
          onPress={() => update($, quoteHidden, was => !was)}
        />
        <Text color={MUTED}>{isQuoteHidden ? 'show quote' : 'hide quote'}</Text>
      </Box>
    )

    const quoteBlock = !quote || !isFun ? null : (
      <Box flexDirection="column">
        {!isQuoteHidden && (e.surface === 'terminal'
          ? <Text bold color={QUOTE_COLOR}>{quote}</Text>
          : (() => {
              const { Svg } = $.ui.resolve(e)
              return <Svg source={quoteSvg(quote)} alt={quote} />
            })())}
        <Box>{toggleQuote}</Box>
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={1}>
        {birdy}
        <Text color={DATA}> </Text>
        {greg}
        {isFun && e.surface !== 'terminal' && (() => {
          const { Svg } = $.ui.resolve(e)
          // Between greg and the quote, with 6 rows of space below it.
          return (
            <Box marginTop={2} marginBottom={6} justifyContent="center">
              <Svg source={PIZZA_SVG} alt="a pizza slice surrounded by code symbols" />
            </Box>
          )
        })()}
        {e.surface === 'terminal' && quoteBlock && <Text color={DATA}> </Text>}
        {quoteBlock}
        {isFun && e.surface !== 'terminal' && (() => {
          const { Svg } = $.ui.resolve(e)
          // Mochi sits centered under the quote, 8 rows down.
          return (
            <Box marginTop={8} justifyContent="center">
              <Svg source={MOCHI_SVG} alt="mochi, a pixel dino" />
            </Box>
          )
        })()}
        {/* linkydoos sits under mochi. */}
        <Box flexDirection="column" marginTop={2}>
          <Text bold color={LINKY}>linkydoos ↗</Text>
          {LINKYDOOS.map(l => (
            <Box flexDirection="column" marginTop={1}>
              <Text color={TEXT}>{l.name}</Text>
              <Text>
                <Link href={l.site}><Text color={DATA}>site</Text></Link>
                {dot}
                <Link href={`${GH}${l.repo}`}><Text color={DATA}>repo</Text></Link>
                {dot}
                <Link href={`${GH}${l.repo}/pulls`}><Text color={DATA}>PRs</Text></Link>
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
