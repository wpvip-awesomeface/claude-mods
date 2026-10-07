import { expect, mock, test } from 'claude-code/testing'

test('/fun flips fun mode and /fun on|off set it outright', async ($, on) => {
  mock.store(on)
  const say = async (args: string) => JSON.stringify(await $.command.run({ command: 'fun', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }))

  expect(await say('')).toContain('Fun mode on')
  expect(await say('')).toContain('Fun mode off')
  expect(await say('on')).toContain('Fun mode on')
  expect(await say('on')).toContain('Fun mode on')
  expect(await say('off')).toContain('Fun mode off')
})
