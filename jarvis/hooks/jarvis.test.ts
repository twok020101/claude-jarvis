import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { repoName, warmthOf } from './register'
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

test('memory banks start from what the saved transcript already holds', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/tony' })
  const reply = (id: string, read: number, write: number) =>
    JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: 0, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: 1 } } })
  const transcript = [reply('m1', 0, 20000), reply('m2', 60000, 0), reply('m2', 60000, 0), '{"type":"user"}'].join('\n')
  const asked: string[] = []
  on('session.root', () => ({ value: '/work/stark.io' }))
  on('session.id', () => ({ value: 'abc' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', ($, e) => {
    asked.push(e.path)
    return { value: transcript }
  })
  on('command.register', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ source: 'startup', cwd: '/work/stark.io' })
  await clock.settle()
  expect(asked).toEqual(['/home/tony/.claude/projects/-work-stark-io/abc.jsonl'])
  const ui = await $.ui.mount({
    plugin: 'jarvis',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'jarvis-hud',
    props: { title: 'J.A.R.V.I.S.', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    viewport: VIEWPORT,
  })
  // m2 is one response written twice: 60k of 80k, 75%.
  expect(await ui.find({ text: /75% PATCHY/ })).toBeDefined()
  expect(await ui.find({ text: /60\.0k recalled · 20\.0k rebuilt/ })).toBeDefined()
  await ui.unmount()
})

// ── Cache guard ─────────────────────────────────────────────────────────
const T0 = Date.parse('2026-10-06T10:00:00Z')
const MIN = 60000
const USAGE1 = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 90000, cache_creation_input_tokens: 0 }

// Boots the mod over a transcript whose last request wrote a `ttl` cache at T0.
async function bootGuard(
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  opts: { ttl: '5m' | '1h' | null; agents: () => string[]; ctxTokens?: number },
) {
  mock.store(on)
  mock.env(on, { HOME: '/home/tony' })
  const clock = mock.clock(on)
  await clock.set(T0)
  const creation = opts.ttl === '1h'
    ? { ephemeral_1h_input_tokens: 4000, ephemeral_5m_input_tokens: 0 }
    : opts.ttl === '5m' ? { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 4000 } : null
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: new Date(T0).toISOString(),
    message: { id: 'm1', usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 4000, output_tokens: 1, ...(creation ? { cache_creation: creation } : {}) } },
  })
  const calls = { fork: 0, compact: 0 }
  on('session.root', () => ({ value: '/work/stark.io' }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.usage', () => ({
    value: { startedAt: T0, context: { percent: 45, tokens: opts.ctxTokens ?? 90000, window: 200000 }, rateLimits: [] },
  }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: line }))
  on('command.register', () => ({ value: { command: 'jarvis' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({
    value: opts.agents().map(id => ({ id, description: 'Map the auth flow', type: 'Explore', status: 'running' as const })),
  }))
  on('model.fork', () => {
    calls.fork += 1
    return { value: { isAnswered: true, text: 'ok', usage: USAGE1 } }
  })
  on('session.compact', () => {
    calls.compact += 1
    return { messages: [], tokensBefore: 90000, tokensAfter: 8000 }
  })
  await $.session.start({ cwd: '/work/stark.io', surface: 'terminal', isInteractive: true })
  await clock.settle()
  return { clock, calls }
}

test('the transcript says which TTL the cache was written with, and when', () => {
  const row = (ts: string, h: number, m: number) =>
    JSON.stringify({ timestamp: ts, message: { usage: { cache_creation: { ephemeral_1h_input_tokens: h, ephemeral_5m_input_tokens: m } } } })
  expect(warmthOf([row('2026-10-06T10:00:00Z', 0, 500), row('2026-10-06T10:02:00Z', 900, 0), '{"type":"user"}'].join('\n')))
    .toEqual({ ttl: '1h', at: Date.parse('2026-10-06T10:02:00Z') })
  expect(warmthOf('{"type":"user"}')).toEqual({ ttl: null, at: 0 })
})

test('with a subagent in flight the cache is kept warm, never compacted', async ($, on) => {
  const { clock, calls } = await bootGuard($, on, { ttl: '5m', agents: () => ['a1'] })
  await clock.advance(3 * MIN)
  expect(calls.fork).toBe(0)
  await clock.advance(1 * MIN)
  expect(calls.fork).toBe(1)
  // Each keep-alive restarts the five minutes, so one lands every 3¾ minutes.
  await clock.advance(20 * MIN)
  expect(calls.fork).toBe(6)
  expect(calls.compact).toBe(0)
})

test('idle with no subagents, the conversation is compacted once before the cache lapses', async ($, on) => {
  const { clock, calls } = await bootGuard($, on, { ttl: '1h', agents: () => [] })
  await clock.advance(50 * MIN)
  expect(calls.compact).toBe(0)
  await clock.advance(6 * MIN)
  expect(calls.compact).toBe(1)
  await clock.advance(3 * 60 * MIN)
  expect(calls.compact).toBe(1)
  expect(calls.fork).toBe(0)
})

test('a subagent landing hands the cache over to compaction', async ($, on) => {
  let flying = ['a1']
  const { clock, calls } = await bootGuard($, on, { ttl: '5m', agents: () => flying })
  await clock.advance(4 * MIN)
  expect(calls.fork).toBe(1)
  flying = []
  await clock.advance(4 * MIN)
  expect(calls.compact).toBe(1)
})

test('a small conversation is left to cool', async ($, on) => {
  const small = await bootGuard($, on, { ttl: '5m', agents: () => [], ctxTokens: 5000 })
  await small.clock.advance(30 * MIN)
  expect(small.calls).toEqual({ fork: 0, compact: 0 })
})

test('an unknown TTL leaves the cache alone', async ($, on) => {
  const { clock, calls } = await bootGuard($, on, { ttl: null, agents: () => ['a1'] })
  await clock.advance(30 * MIN)
  expect(calls).toEqual({ fork: 0, compact: 0 })
})

test('/jarvis cache off disengages the guard', async ($, on) => {
  const { clock, calls } = await bootGuard($, on, { ttl: '5m', agents: () => ['a1'] })
  await $.command.run({ ...RUN, command: 'jarvis', args: 'cache off' })
  await clock.advance(30 * MIN)
  expect(calls).toEqual({ fork: 0, compact: 0 })
})
