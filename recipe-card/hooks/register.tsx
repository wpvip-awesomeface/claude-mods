import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Card } from '../types'

// Muted Dracula pink for the name, greys for everything else (matches bento).
// TEXT for glyphs and words, DATA a step darker for values.
const NAME = '#C291B3'
const TEXT = '#D4D4D4'
const DATA = '#A3A3A3'
const SKILLOS = '#FF8FB1' // Dracula-style pink salmon for the SkillOS label on the route line
const RADAR = '#8BE9FD' // Dracula cyan for turn-timer's Speed Radar row

// turn-timer's per-reply durations (read-only here; turn-timer owns them).
const times = atom({ plugin: 'turn-timer', key: 'times' } as const, [] as { tail: string; ms: number }[])
const tailOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(-160)
const took = (ms: number) => {
  const total = Math.max(1, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h && `${h}h`, (h || m) && `${m}m`, `${s}s`].filter(Boolean).join(' ')
}

const card = atom({ plugin: 'recipe-card', key: 'card' } as const, null)
const saved = atom({ plugin: 'recipe-card', key: 'saved' } as const, 0)
const isHidden = atom({ plugin: 'recipe-card', key: 'isHidden' } as const, false)

// The route line every substantive answer ends with, in glyphs:
// ◎ <shape> · † ✓/–/⊘ · ◫ ✓/–/⊘ [tool] · ≡ n · ✦ ✓/– <reason>
// (the older emoji form, 🧭 · 🪦 · 📚 · 🪜 · 🧰 with ✅/➖/🔒, still parses).
const ROUTE_GLYPHS = /^◎\s*(\S+)\s*·\s*†\s*(✓|–|⊘)\s*·\s*◫\s*(✓|–|⊘)\s*([^·]*?)\s*·\s*≡\s*(\d)\s*·\s*✦\s*(✓|–)\s*(.*)$/u
const ROUTE_EMOJI = /🧭\s*(\S+).*?📚\s*(✅|➖|🔒)[^·]*·\s*🪜\s*(\d).*?🧰\s*(✅|➖)\s*(.*)$/mu

type Route = { shape: string; graveyard: string; library: string; tool: string; rung: string; extract: string; reason: string }

const YES = new Set(['✓', '✅'])
const MISS = new Set(['–', '➖'])

// One line read as a glyph route line; an unmatched group reads as ''.
const glyphRoute = (line: string): Route | null => {
  const g = line.match(ROUTE_GLYPHS)
  if (!g) return null
  const [, shape = '', graveyard = '', library = '', tool = '', rung = '', extract = '', reason = ''] = g
  return { shape, graveyard, library, tool, rung, extract, reason: reason.trim() }
}

// The last line of an answer, when it is a route line.
const routeOf = (answer: string): Route | null => {
  const last = answer.trimEnd().split('\n').pop()?.trim() ?? ''
  const g = glyphRoute(last)
  if (g) return g
  const m = answer.match(ROUTE_EMOJI)
  if (m) return { shape: m[1] ?? '', graveyard: '', library: m[2] ?? '', tool: '', rung: m[3] ?? '', extract: m[4] ?? '', reason: (m[5] ?? '').trim() }
  return null
}

const spot = (answer: string, at: number): Card | null => {
  const r = routeOf(answer)
  if (!r) return null

  if (YES.has(r.extract)) return { shape: r.shape, reason: r.reason, why: 'extract', at }
  // No library tool and a real climb: likely a fresh solve worth a second look.
  if (MISS.has(r.library) && Number(r.rung) >= 3) return { shape: r.shape, reason: r.reason, why: 'fresh', at }

  return null
}

const recipePrompt = (c: Card) => [
  'Run the toolsmith skill on the solve we just finished',
  `(${c.shape}: ${c.reason}).`,
  'Decide whether it should become a skills-os library tool. If yes, generalize it, ship the mandatory files,',
  'log it, and commit to the skills-os library. If no, say why in one line.',
].join(' ')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'recipe', description: 'Save the last fresh solve as a skills-os recipe (toolsmith)' })

    return next(e)
  })

  on('command.run', { command: 'recipe' }, async $ => {
    const c = await read($, card)
    const text = c ? recipePrompt(c) : recipePrompt({ shape: 'solve', reason: 'the most recent fresh solve in this session', why: 'fresh', at: 0 })

    await update($, card, () => null)
    await update($, saved, n => n + 1)
    void $.prompt.submit({ text })

    return { text: 'Writing up the recipe card…' }
  })

  // /hush (owned by bento) hides the card band too.
  on('state.set', { plugin: 'bento', key: 'hushed' }, async ($, e, next) => {
    const result = await next(e)
    await update($, isHidden, () => !!e.value)
    return result
  }).catch(($, e, next) => next(e)) // a failed hide never blocks /hush itself

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || !e.answer) return result

    const found = spot(e.answer, await $.clock.now())
    if (found) {
      await update($, card, () => found)
    }

    return result
  })

  // Draws the route line at the end of a reply as its own quiet row: glyphs in TEXT,
  // values in DATA, with a little room above. The rest of the reply draws as usual.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    const lines = text.trimEnd().split('\n')
    const last = lines[lines.length - 1]?.trim() ?? ''
    const r = glyphRoute(last)
    if (!r) return next(e)

    const { shape, graveyard, library, tool, rung, extract, reason } = r
    const rest = lines.slice(0, -1).join('\n').trimEnd()
    const drawn = rest ? await next({ ...e, props: { ...e.props, text: rest } }) : null
    const { Box, Text } = $.ui.resolve(e)
    const dot = <Text color={DATA}> · </Text>
    // Spell the line out in plain words: the glyphs read too small next to body text.
    const pair = (label: string, value: string) => (
      <Text><Text color={TEXT}>{label} </Text><Text color={DATA}>{value}</Text></Text>
    )
    const status = (v: string, yes: string, miss: string) => (v === '✓' ? yes : v === '⊘' ? 'locked' : miss)
    const libraryValue = library === '✓' ? (tool || 'hit') : status(library, 'hit', 'no tool')
    const tail = tailOf(text)
    const timed = [...(await read($, times))].reverse().find(t => t.tail === tail)

    return (
      <Box flexDirection="column">
        {drawn}
        {timed && (
          <Box marginTop={1} paddingX={1}>
            <Text><Text bold color={RADAR}>Speed Radar: </Text><Text color={DATA}>⏱ {took(timed.ms)}</Text></Text>
          </Box>
        )}
        <Box marginTop={timed ? 0 : 1} paddingX={1}>
          <Text>
            <Text bold color={SKILLOS}>SkillOS </Text>
            {pair('task', shape)}{dot}
            {pair('dead ends', status(graveyard, 'found', 'none'))}{dot}
            {pair('library', libraryValue)}{dot}
            {pair('rung', rung)}{dot}
            {pair('save as tool', status(extract, 'yes', 'no'))}
            {reason && dot}{reason && <Text color={DATA}>{reason}</Text>}
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, card)

    if (e.props.hasSurvey || !c || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const dot = <Text color={DATA}> · </Text>
    const reason = c.reason.length > 44 ? `${c.reason.slice(0, 43)}…` : c.reason
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text>
            <Text bold color={NAME}>▭ recipe card </Text>
            <Text color={TEXT}>{c.why === 'extract' ? 'worth keeping' : 'fresh solve'}</Text>
            {dot}<Text color={DATA}>{c.shape}</Text>
            {reason && dot}{reason && <Text color={DATA}>{reason}</Text>}
          </Text>
          <Button key="save" label="Save recipe" onPress={async () => {
            await update($, card, () => null)
            await update($, saved, n => n + 1)
            void $.prompt.submit({ text: recipePrompt(c) })
          }} />
          <Button key="skip" label="Skip" onPress={() => update($, card, () => null)} />
        </Box>
        {below}
      </Box>
    )
  })
}
