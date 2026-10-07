import { atom, read, update } from 'claude-code'
import type { EngineInterface as Dollar, Register } from 'claude-code'

import type { Lunch } from '../types'

const EMPTY: Lunch = { startedAt: 0, turns: 0, helpers: 0, percent: 0, tokens: 0 }

const lunch = atom({ plugin: 'bento', key: 'lunch' } as const, EMPTY)
const warned = atom({ plugin: 'bento', key: 'warned' } as const, { context: false, turns: false })
const isHidden = atom({ plugin: 'bento', key: 'isHidden' } as const, false)
// The master switch: /hush flips it, and the other mods follow it (they hook its writes).
const hushed = atom({ plugin: 'bento', key: 'hushed' } as const, false)
// A colored notice in bento's mint, in place of plain toasts.
const flash = atom({ plugin: 'bento', key: 'flash' } as const, null)

const CONTEXT_LIMIT = 70
const TURN_LIMIT = 60

const HANDOFF_PROMPT = [
  'Pack a doggy bag: write a 5-10 line handoff for this session so I can start fresh.',
  'Cover goal, current state, links (PRs, preview URLs, files), and the next step.',
  'Put it in one fenced block I can paste into a new session. Keep it tight.',
].join(' ')

// The handoff as the command's own output: one tool-less fork over this
// session's transcript (served from the prompt cache), so it works on demand
// and never waits on a queued turn. Copied to the clipboard as well.
const FORK_PROMPT = [
  HANDOFF_PROMPT,
  'Reply with only the fenced block: no preamble, no follow-up questions, no tool use.',
].join(' ')

const unfence = (text: string) => {
  const m = text.match(/```[a-z]*\n([\s\S]*?)```/)
  return (m?.[1] ?? text).trim()
}

const pack = async ($: Dollar): Promise<string> => {
  const reply = await $.model.fork({ prompt: FORK_PROMPT })
  if (!reply.isAnswered) {
    if (reply.reason === 'nothing-to-fork') {
      return 'Nothing to pack yet: this session has no replies to hand off.'
    }
    // Fall back to asking in a normal turn.
    void $.prompt.submit({ text: HANDOFF_PROMPT })
    return `Couldn't pack it directly (${reply.reason}); asked in the next turn instead.`
  }
  const handoff = unfence(reply.text)
  const copied = await $.ui.copy({ text: handoff })
  const note = copied.isCopied ? 'Copied to your clipboard. ' : ''
  return `Doggy bag packed. ${note}Paste it into a new session:\n\n\`\`\`\n${handoff}\n\`\`\``
}

// Quiet palette: green for the name only, greys for everything else.
const SAGE = '#6CF5A8' // the name: bright Dracula-style mint
const TEXT = '#D4D4D4' // words
const DATA = '#A3A3A3' // numbers, a step darker so they stand apart

// Single-color glyphs only: the plate fills as context grows.
const plate = (percent: number) =>
  percent < 25 ? { icon: '○', mood: 'plenty of room' }
  : percent < 50 ? { icon: '◔', mood: 'nibbling' }
  : percent < CONTEXT_LIMIT ? { icon: '◑', mood: 'half full' }
  : percent < 85 ? { icon: '◕', mood: 'getting full, /handoff soon' }
  : { icon: '●', mood: 'stuffed, /handoff now' }

const FLASH_MS = 10_000

const say = async ($: Dollar, text: string) => {
  const id = await $.clock.now()
  await update($, flash, () => ({ glyph: '▦', name: 'bento', color: SAGE, text, id }))
  $.clock.after(FLASH_MS, () => void update($, flash, f => (f && f.id === id ? null : f)))
}

const short = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'doggybag',
      description: 'Pack a short handoff so you can start a fresh session',
    })
    await $.command.register({
      name: 'handoff',
      description: 'Write a short handoff for a fresh session (same as /doggybag)',
    })
    await $.command.register({
      name: 'hush',
      description: 'Hide or show every mod at once (bento, Workbench, recipe card), e.g. for screenshares',
    })
    await $.command.register({
      name: 'bento',
      description: 'Show or hide the bento band above the prompt',
    })

    return next(e)
  })

  // /handoff is the plain-named alias of /doggybag.
  for (const command of ['doggybag', 'handoff']) {
    on('command.run', { command }, async $ => {
      await say($, 'Packing a doggy bag…')
      return { text: await pack($) }
    })
  }

  on('command.run', { command: 'hush' }, async $ => {
    const isHushed = await update($, hushed, was => !was)
    await update($, isHidden, () => isHushed)

    return { text: isHushed ? 'Hushed: mods hidden. /hush brings them back.' : 'Mods are back.' }
  })

  on('command.run', { command: 'bento' }, async $ => {
    const hidden = await update($, isHidden, was => !was)

    return { text: hidden ? 'Bento tucked away.' : 'Bento is back.' }
  })

  // Count helpers the main loop sends out (subagents).
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent' && !e.agentId) {
      await update($, lunch, l => ({ ...l, helpers: l.helpers + 1 }))
    }

    return next(e)
  }).catch(($, e, next) => next(e)) // a failed count never blocks the tool call

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId) {
      return result
    }

    const usage = await $.session.usage()
    const now = await update($, lunch, l => {
      // A new startedAt means /clear or a new session: start a fresh box.
      const base = l.startedAt === usage.startedAt ? l : { ...EMPTY, startedAt: usage.startedAt }

      return {
        ...base,
        turns: base.turns + 1,
        percent: usage.context.percent ?? base.percent,
        tokens: usage.context.tokens ?? base.tokens,
      }
    })

    if (now.turns === 1) {
      await update($, warned, () => ({ context: false, turns: false }))
    }

    const was = await read($, warned)

    if (!was.context && now.percent >= CONTEXT_LIMIT) {
      await update($, warned, w => ({ ...w, context: true }))
      await say($, `${now.percent}% full. Run /handoff and start fresh.`)
    } else if (!was.turns && now.turns >= TURN_LIMIT) {
      await update($, warned, w => ({ ...w, turns: true }))
      await say($, `${now.turns} turns in this box. Run /handoff and start fresh.`)
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const l = await read($, lunch)
    const f = await read($, flash)
    const { Box, Text, Button } = $.ui.resolve(e)
    const notice = !f || e.props.hasSurvey ? null : (
      <Box gap={1}>
        <Text><Text bold color={f.color}>{f.glyph} {f.name} </Text><Text color={TEXT}>{f.text}</Text></Text>
        <Button key="flash-close" plain dimColor label="×" onPress={() => update($, flash, () => null)} />
      </Box>
    )

    if (e.props.hasSurvey || l.turns === 0 || (await read($, isHidden))) {
      if (!notice) return next(e)
      const rest = await next(e)
      return <Box flexDirection="column">{notice}{rest}</Box>
    }

    const { icon, mood } = plate(l.percent)
    const isFull = l.percent >= CONTEXT_LIMIT || l.turns >= TURN_LIMIT
    const dot = <Text color={DATA}> · </Text>
    // Draw whatever sits beneath (other mods' bands) under this one, so bands stack.
    const below = await next(e)

    return (
      <Box flexDirection="column">
      {notice}
      <Box gap={1}>
        <Text>
          <Text bold color={SAGE}>▦ bento </Text>
          <Text color={TEXT}>{icon} </Text>
          <Text color={DATA}>{l.percent}%</Text>
          {dot}
          <Text color={DATA}>{short(l.tokens)}</Text>
          {dot}
          <Text color={TEXT}>turn </Text>
          <Text color={DATA}>{l.turns}</Text>
          {l.helpers > 0 && dot}
          {l.helpers > 0 && <Text color={DATA}>{l.helpers}</Text>}
          {l.helpers > 0 && <Text color={TEXT}> helper{l.helpers === 1 ? '' : 's'}</Text>}
          {dot}
          <Text color={TEXT}>{mood}</Text>
        </Text>
        {isFull && (
          <Button key="bag" label="Doggy bag" onPress={() => void $.command.run({ command: 'handoff', args: '' })} />
        )}
      </Box>
      {below}
      </Box>
    )
  })
}
