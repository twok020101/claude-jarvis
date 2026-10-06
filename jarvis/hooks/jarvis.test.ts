import { expect, mock, test } from 'claude-code/testing'

import { repoName } from './register'
import { roundsOf } from './rounds'

const VIEWPORT = { columns: 140, rows: 40, isFullscreen: true }
const SAY = { wait: false, origin: { kind: 'composer' } } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as const
const BAND = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 10,
  bodyColumns: 135,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

test('the spinner is an arc reactor that types its phrase out', async $ => {
  for (const surface of ['terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'jarvis',
      surface,
      component: 'Spinner',
      props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
      viewport: VIEWPORT,
    })
    expect(await ui.find({ text: /THINKING/, in: 'reactor' })).toBeDefined()
    await ui.advance(80 * 30)
    expect(await ui.find({ text: /Running Stark heuristics/, in: 'reactor' })).toBeDefined()
    await ui.unmount()
  }
})

test('a subagent opens an uplink in the band, then lands its intel', async ($, on) => {
  let release = () => {}
  let started = () => {}
  const gate = new Promise<void>(r => (release = r))
  const running = new Promise<void>(r => (started = r))
  on('tool.call', { tool: 'Agent' }, async () => {
    started()
    await gate
    return { result: { text: 'done' } }
  })
  const call = $.tool.call({ tool: 'Agent', description: 'Map the auth flow', prompt: 'go', subagent_type: 'Explore' })
  await running

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'jarvis', surface, component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    await ui.resize({ columns: 135, rows: 10 })
    expect(await ui.find({ text: /JARVIS/, in: 'hud' })).toBeDefined()
    expect(await ui.find({ text: /EXPLORE/, in: 'hud' })).toBeDefined()
    expect(await ui.find({ text: /^⇢$/, in: 'hud' })).toBeDefined()
    await ui.unmount()
  }

  release()
  await call
  const ui = await $.ui.mount({ plugin: 'jarvis', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  await ui.resize({ columns: 135, rows: 10 })
  expect(await ui.find({ text: /^✓$/, in: 'hud' })).toBeDefined()
  await ui.unmount()
})

test('the honorific is configurable and shows when a turn closes', async ($, on) => {
  mock.store(on)
  await $.command.run({ ...RUN, command: 'jarvis', args: 'title boss' })
  const ui = await $.ui.mount({
    plugin: 'jarvis',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 3200 },
  })
  expect(await ui.find({ text: /PROTOCOL COMPLETE/ })).toBeDefined()
  expect(await ui.find({ text: /Standing by, boss\./ })).toBeDefined()
  await ui.unmount()
})

test('typing "jarvis off" restores the default interface, "jarvis on" brings it back', async ($, on) => {
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
  on('ui.render', { component: 'TurnDuration' }, () => ({ type: 'Text', props: {}, children: ['Baked for 3s'] }))
  const off = await $.prompt.submit({ ...SAY, text: 'jarvis off' })
  expect('drop' in off && off.drop).toBeTruthy()
  const turn = await $.ui.mount({ plugin: 'jarvis', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
  expect(await turn.find({ text: /Baked for 3s/ })).toBeDefined()
  expect(await turn.find({ text: /PROTOCOL COMPLETE/ })).toBeUndefined()
  await turn.unmount()
  await $.prompt.submit({ ...SAY, text: 'Jarvis, on' })
  const back = await $.ui.mount({ plugin: 'jarvis', surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } })
  expect(await back.find({ text: /PROTOCOL COMPLETE/ })).toBeDefined()
  await back.unmount()
  await $.prompt.submit({ ...SAY, text: 'jarvis off' })
  const ui = await $.ui.mount({ plugin: 'jarvis', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
  expect(await ui.find({ text: /JARVIS/ })).toBeUndefined()
  await ui.unmount()
})

test('the diagnostics pane draws the arc reactor and the stats', async $ => {
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'jarvis',
      surface,
      component: 'Pane',
      requestId: 'jarvis-hud',
      props: { title: 'J.A.R.V.I.S.', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
      viewport: VIEWPORT,
    })
    expect(await ui.find({ text: /Intelligent System/ })).toBeDefined()
    for (const label of ['Suit Status', 'Neural Core', 'Reactor Load', 'Memory Banks', 'Repulsor Output', 'Iron Legion', 'Missions Flown', 'Voice Protocol', 'Base Location', 'Armory']) {
      expect(await ui.find({ text: new RegExp(`^${label}\\s+$`) })).toBeDefined()
    }
    expect(await ui.find({ text: /^Hovering · awaiting orders$/ })).toBeDefined()
    expect(await ui.find({ text: /^All suits docked$/ })).toBeDefined()
    expect(await ui.find({ text: /MUNITIONS RELOADED/ })).toBeDefined()
    expect(await ui.find({ text: /^0 directives this session$/ })).toBeDefined()
    expect(await ui.find({ text: /^J\.A\.R\.V\.I\.S\. · calls you "sir"$/ })).toBeDefined()
    expect(await ui.find({ text: /MISSION LOG/ })).toBeDefined()
    if (surface !== 'mobile') expect(await ui.find({ text: /█/, in: 'arc' })).toBeDefined()
    await ui.unmount()
  }
})

test('an edited file shows as a round reloaded, counted per edit', async ($, on) => {
  on('tool.call', { tool: 'Edit' }, async () => ({ result: {} }))
  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'Edit', file_path: '/tmp/arc.ts', old_string: 'a', new_string: 'b' })
  }
  const ui = await $.ui.mount({
    plugin: 'jarvis',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'jarvis-hud',
    props: { title: 'J.A.R.V.I.S.', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    viewport: VIEWPORT,
  })
  expect(await ui.find({ text: /^arc\.ts$/ })).toBeDefined()
  expect(await ui.find({ text: /rapid fire|reloaded ×3/ })).toBeDefined()
  await ui.unmount()
})

test('/jarvis seats a console left waiting by the startup open', async ($, on) => {
  mock.store(on)
  let seated = false
  let closes = 0
  on('ui.open', { id: 'jarvis-hud' }, () =>
    seated ? { value: { isPlaced: true } } : { value: { isPlaced: false, reason: 'unasked under 144 columns (now 120)' } },
  )
  on('ui.close', { id: 'jarvis-hud' }, () => {
    closes += 1
    seated = true
    return { value: undefined }
  })
  const out = await $.command.run({ ...RUN, command: 'jarvis', args: '' })
  expect(closes).toBe(1)
  expect('text' in out ? out.text : '').toMatch(/^Workstation console open\./)
})

test('rounds stored as bare paths by an older version still read', () => {
  expect(roundsOf(['/tmp/old.ts', { path: '/tmp/new.ts', rounds: 3 }, null, 42])).toEqual([
    { path: '/tmp/old.ts', rounds: 1 },
    { path: '/tmp/new.ts', rounds: 3 },
  ])
})

test('while a tool runs, the one short status line names it and nothing more', async ($, on) => {
  let release = () => {}
  let started = () => {}
  const gate = new Promise<void>(r => (release = r))
  const running = new Promise<void>(r => (started = r))
  on('tool.call', { tool: 'Bash' }, async () => {
    started()
    await gate
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const call = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await running
  const ui = await $.ui.mount({
    plugin: 'jarvis',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' },
    viewport: { columns: 140, rows: 40 },
  })
  await ui.resize({ columns: 140, rows: 1 })
  expect(await ui.find({ text: /^BASH$/, in: 'reactor' })).toBeDefined()
  expect(await ui.find({ text: /npm test/, in: 'reactor' })).toBeDefined()
  expect(await ui.find({ text: /tok\/s|%/, in: 'reactor' })).toBeUndefined()
  await ui.unmount()
  release()
  await call
})

test('a subagent launch and return each say so in a notification', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Agent' }, async () => ({ result: { text: 'done' } }))
  await $.tool.call({ tool: 'Agent', description: 'Scan the repo', prompt: 'go', subagent_type: 'Explore' })
  expect(toasts).toEqual(['⇢ Deploying EXPLORE: Scan the repo', '✓ EXPLORE is back with intel.'])
})

test('a background subagent stays airborne until its own turn completes', async ($, on) => {
  mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Agent' }, async () => ({
    result: { status: 'async_launched', agentId: 'a1', description: 'Map the auth flow', prompt: 'go', outputFile: '/tmp/a1' },
  }))
  await $.tool.call({ tool: 'Agent', description: 'Map the auth flow', prompt: 'go', subagent_type: 'Explore', run_in_background: true })
  expect(toasts).toEqual(['⇢ Deploying EXPLORE: Map the auth flow'])

  const band = async (glyph: RegExp) => {
    const ui = await $.ui.mount({ plugin: 'jarvis', surface: 'terminal', component: 'AbovePrompt', props: BAND, viewport: VIEWPORT })
    await ui.resize({ columns: 135, rows: 10 })
    const found = await ui.find({ text: glyph, in: 'hud' })
    await ui.unmount()
    return found
  }
  expect(await band(/^⇢$/)).toBeDefined()

  await $.turn.complete({ answer: 'found it', durationMs: 4000, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
  expect(toasts).toEqual(['⇢ Deploying EXPLORE: Map the auth flow', '✓ EXPLORE is back with intel.'])
  expect(await band(/^✓$/)).toBeDefined()
})

test('the armory names any git repo, not only allowlisted ones', () => {
  expect(repoName(null)).toBe(null)
  expect(repoName({ root: '/u/p/claude-jarvis', remote: 'https://github.com/twok020101/claude-jarvis.git', internal: false, name: null })).toBe('twok020101/claude-jarvis')
  expect(repoName({ root: '/u/p/x', remote: 'git@github.com:me/thing.git', internal: false, name: null })).toBe('me/thing')
  expect(repoName({ root: '/u/p/local-only', remote: null, internal: false, name: null })).toBe('local-only')
})

test('memory banks tally prompt-cache hits and misses across turns', async ($, on) => {
  mock.clock(on)
  on('turn.complete', () => ({ text: '' }))
  const usage = (read: number, write: number, fresh: number) => ({
    model: 'claude-opus-5-5', input_tokens: fresh, output_tokens: 100, cache_read_input_tokens: read, cache_creation_input_tokens: write,
  })
  await $.turn.complete({ answer: 'a', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: usage(80000, 15000, 5000) })
  await $.turn.complete({ answer: 'b', durationMs: 1000, isAborted: false, turnId: 't2', agentId: 'sub', reason: 'answer', usage: usage(10000, 0, 0) })
  const ui = await $.ui.mount({
    plugin: 'jarvis',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'jarvis-hud',
    props: { title: 'J.A.R.V.I.S.', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    viewport: VIEWPORT,
  })
  // 90k read of 110k sent: 82%.
  expect(await ui.find({ text: /82% LOCKED IN/ })).toBeDefined()
  expect(await ui.find({ text: /90\.?0?k recalled · 20\.?0?k rebuilt/ })).toBeDefined()
  await ui.unmount()
})
