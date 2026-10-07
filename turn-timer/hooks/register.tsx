import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Timing } from '../types'

// Dracula cyan for the label, bento grey for the value.
const RADAR = '#8BE9FD'
const DATA = '#A3A3A3'
const KEEP = 50

const times = atom({ plugin: 'turn-timer', key: 'times' } as const, [] as Timing[])

// The route line recipe-card draws; it draws the time above it itself.
const ROUTE = /^◎\s*\S+\s*·\s*†/u

// Matches a reply to its turn by the end of its text.
export const tailOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(-160)

// 42s, 2m 15s, 1h 4m 2s. No milliseconds.
export const format = (ms: number) => {
  const total = Math.max(1, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h && `${h}h`, (h || m) && `${m}m`, `${s}s`].filter(Boolean).join(' ')
}

// Deliberately ignores /hush (bento): the speed row is fine to show in demos.
export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || !e.answer) return result

    const entry = { tail: tailOf(e.answer), ms: e.durationMs }
    await update($, times, list => [...(list ?? []), entry].slice(-KEEP))

    return result
  })

  // Replies without a route line get the time row here.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    const last = text.trimEnd().split('\n').pop()?.trim() ?? ''
    if (ROUTE.test(last)) return next(e)

    const tail = tailOf(text)
    const hit = [...(await read($, times))].reverse().find(t => t.tail === tail)
    if (!hit) return next(e)

    const drawn = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {drawn}
        <Box marginTop={1} paddingX={1}>
          <Text><Text bold color={RADAR}>Speed Radar: </Text><Text color={DATA}>⏱ {format(hit.ms)}</Text></Text>
        </Box>
      </Box>
    )
  })
}
