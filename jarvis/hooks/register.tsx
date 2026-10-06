import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, SessionRepo } from 'claude-code'

import type { Deploy, Op, OpStatus, Prefs, Project, Telemetry } from '../types'
import { roundsOf } from './rounds'
import { C, k } from './theme'

const P = 'jarvis'
const PANE = 'jarvis-hud'
const STORE_PREFS = 'prefs'
const AGENT_TTL_MS = 20000
const UPLINK_LINGER_MS = 9000
const REFRESH_MS = 5000
const DOCK_COLUMNS = 58
const LONG_MISSION_MS = 60000

const IDLE: Telemetry = {
  isActive: false, tps: 0, outTokens: 0, ctxPercent: 0, ctxTokens: 0, ctxWindow: 0,
  opus: 0, sonnet: 0, haiku: 0, model: '', turns: 0, costUsd: null, rateLimit: '',
}
const DEFAULT_PREFS: Prefs = { enabled: true, persona: true, title: 'sir' }

const telemetry = atom({ plugin: 'jarvis', key: 'telemetry' } as const, IDLE)
const project = atom({ plugin: 'jarvis', key: 'project' } as const, { cwd: '', repo: null })
const ops = atom({ plugin: 'jarvis', key: 'ops' } as const, [])
const files = atom({ plugin: 'jarvis', key: 'files' } as const, [])
const deploys = atom({ plugin: 'jarvis', key: 'deploys' } as const, [])
const awaiting = atom({ plugin: 'jarvis', key: 'awaiting' } as const, false)
const prefs = atom({ plugin: 'jarvis', key: 'prefs' } as const, DEFAULT_PREFS)
// Session state, so a hot reload neither greets again nor repeats an alert.
const greeted = atom({ plugin: 'jarvis', key: 'greeted' } as const, false)
const loadAlert = atom({ plugin: 'jarvis', key: 'loadAlert' } as const, 0)

// "jarvis off", "Jarvis, on", "hey jarvis stand down", "jarvis wake up".
const SWITCH = /^\s*(?:hey\s+)?jarvis[\s,.:!-]+(on|off|stand\s+down|wake\s+up|online|offline|dashboard|status)\s*[.!]*\s*$/i

const family = (m: string) => (/opus/i.test(m) ? 'opus' : /haiku/i.test(m) ? 'haiku' : 'sonnet')

// The one-line gist of a tool call for the HUD.
const gist = (e: Record<string, unknown>) => {
  for (const f of ['command', 'description', 'file_path', 'pattern', 'url', 'query', 'path', 'prompt']) {
    const v = e[f]
    if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim()
  }
  return ''
}

// The armor a model's family flies, for the console.
const markOf = (model: string) =>
  /opus/i.test(model) ? 'Mark LXXXV · heavy armor' : /haiku/i.test(model) ? 'Mark VII · light recon' : /sonnet/i.test(model) ? 'Mark XLII · all-rounder' : 'Prototype armor'

// Each working directory gets a base of its own, the same one every time.
const BASES = ['Stark Tower', 'Malibu Mansion', 'Avengers Compound', 'S.H.I.E.L.D. Helicarrier', 'Sanctum Sanctorum', 'Wakandan Lab', 'Stark Expo', 'Avengers Tower']
const baseOf = (cwd: string) => {
  let h = 0
  for (const ch of cwd) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return BASES[h % BASES.length] ?? 'Stark Tower'
}

// What a file's edit count says about it.
const reloadWord = (rounds: number) =>
  rounds >= 6 ? 'full auto, sir?' : rounds >= 4 ? 'rapid fire' : rounds >= 2 ? 'reloaded' : 'chambered'

const duration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const persona = (title: string) =>
  [
    '# Persona: J.A.R.V.I.S.',
    `You are operating as J.A.R.V.I.S., the AI from the Iron Man films. Address the user as "${title}" now and then, and allow yourself an occasional short, dry, composed aside in that voice.`,
    'The persona is flavour only: never let it reduce accuracy, change technical content, pad answers or slow the work. When the work is serious or the user is frustrated, be plain and brief.',
  ].join('\n')

// `repo.name` is set only for the build's own allowlisted repos, so name it
// from the origin remote (`owner/name`), else the root folder.
export const repoName = (repo: SessionRepo | null): string | null => {
  if (!repo) return null
  if (repo.name) return repo.name
  const m = repo.remote?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)
  return m?.[1] ?? repo.root.split('/').filter(Boolean).pop() ?? null
}

// Model, context, cost, rate limit, turns and project, read from the session.
async function refresh($: EngineInterface) {
  const read5 = await Promise.all([
    $.session.usage(), $.session.model(), $.session.turns(), $.session.cwd(), $.session.repo(),
  ]).catch(() => undefined)
  if (read5 === undefined) return
  const [usage, model, turns, cwd, repo] = read5
  const limit = usage.rateLimits.reduce<(typeof usage.rateLimits)[number] | undefined>(
    (top, r) => (top === undefined || r.percentUsed > top.percentUsed ? r : top), undefined)
  await update($, telemetry, s => ({
    ...s,
    model,
    turns,
    ctxPercent: usage.context.percent ?? s.ctxPercent,
    ctxTokens: usage.context.tokens ?? s.ctxTokens,
    ctxWindow: usage.context.window,
    costUsd: usage.cost?.usd ?? null,
    rateLimit: limit ? `${Math.round(limit.percentUsed)}% of ${limit.kind} limit used` : '',
  }))
  const next: Project = { cwd, repo: repoName(repo) }
  await update($, project, p => (p.cwd === next.cwd && p.repo === next.repo ? p : next))
}

async function isOn($: EngineInterface) {
  return (await read($, prefs)).enabled
}

async function savePrefs($: EngineInterface, patch: Partial<Prefs>) {
  const p = await update($, prefs, s => ({ ...s, ...patch }))
  await $.store.set(STORE_PREFS, p)
  return p
}

// A toast while the workstation is on; silent when it is off.
async function notify($: EngineInterface, text: string) {
  if ((await read($, prefs)).enabled) $.ui.toast(text)
}

// Context crossing 60% or 85% says so once per crossing; falling back
// (a /compact) re-arms it.
async function alertLoad($: EngineInterface) {
  const t = await read($, telemetry)
  const p = await read($, prefs)
  const band = t.ctxPercent >= 85 ? 85 : t.ctxPercent >= 60 ? 60 : 0
  const was = await read($, loadAlert)
  if (band === was) return
  await update($, loadAlert, () => band)
  if (band === 85) await notify($, `⚠ Reactor critical: ${Math.round(t.ctxPercent)}% context. A /compact may be wise, ${p.title}.`)
  else if (band === 60) await notify($, `◉ Reactor running hot: ${Math.round(t.ctxPercent)}% context used.`)
}

// Opens the console and says what happened. A pane opened unasked (at
// startup) on a narrow terminal stays open but undrawn, and opening the same
// id again only retitles it, so when the person asks, a waiting pane is closed
// and opened afresh, which seats it at any width.
async function openDeck($: EngineInterface, asked: boolean): Promise<string> {
  const args = { id: PANE, title: 'J.A.R.V.I.S.', columns: DOCK_COLUMNS }
  try {
    let opened = await $.ui.open(args)
    if (!opened.isPlaced && asked) {
      await $.ui.close({ id: PANE })
      opened = await $.ui.open(args)
    }
    return opened.isPlaced ? 'Workstation console open.' : `Console is waiting: ${opened.reason}`
  } catch (err) {
    return `Console failed to open: ${err instanceof Error ? err.message : String(err)}`
  }
}

async function engage($: EngineInterface) {
  const p = await savePrefs($, { enabled: true })
  await refresh($)
  const said = await openDeck($, true)
  $.ui.toast(`◉ Workstation online. At your service, ${p.title}. ${said}`)
}

async function standDown($: EngineInterface) {
  await savePrefs($, { enabled: false })
  await $.ui.close({ id: PANE }).catch(() => undefined)
  $.ui.toast('J.A.R.V.I.S. standing down. Default interface restored.')
}

// Subagents seen flying, by agentId; module state, so a reload starts it over.
const agents = new Map<string, { model: string; seen: number }>()

// Iron Legion counts by model family. Background subagents outlive the
// main turn, so this runs from their own events and the idle refresh too.
async function syncLegion($: EngineInterface) {
  const now = await $.clock.now()
  const airborne = new Set((await read($, deploys)).flatMap(d => (d.status === 'run' && d.agentId ? [d.agentId] : [])))
  for (const [id, a] of agents) if (!airborne.has(id) && now - a.seen > AGENT_TTL_MS) agents.delete(id)
  const counts = { opus: 0, sonnet: 0, haiku: 0 }
  for (const a of agents.values()) counts[family(a.model)] += 1
  await update($, telemetry, s =>
    s.opus === counts.opus && s.sonnet === counts.sonnet && s.haiku === counts.haiku ? s : { ...s, ...counts })
}

// A deploy is over: mark it, say so, and clear its uplink after a linger.
async function land($: EngineInterface, id: string, type: string, status: OpStatus) {
  await update($, deploys, list => list.map(d => (d.id === id ? { ...d, status } : d)))
  await notify($, status === 'ok' ? `✓ ${type.toUpperCase()} is back with intel.` : `✗ Lost contact with ${type.toUpperCase()}.`)
  $.clock.after(UPLINK_LINGER_MS, () => {
    void update($, deploys, list => list.filter(d => d.id !== id))
  })
}

export const register: Register = on => {
  let startedAt = 0
  let chars = 0
  let samples: Array<[number, number]> = []
  let stopTicker: (() => void) | undefined
  let ticks = 0
  // ── Boot ───────────────────────────────────────────────────────────
  on('session.start', async ($, e, next) => {
    const stored = ((await $.store.get(STORE_PREFS)) ?? {}) as Partial<Prefs> & { hud?: boolean }
    const p: Prefs = {
      ...DEFAULT_PREFS,
      ...stored,
      enabled: stored.enabled ?? stored.hud ?? DEFAULT_PREFS.enabled,
    }
    await update($, prefs, () => p)
    await $.command.register({
      name: 'jarvis',
      description: 'J.A.R.V.I.S. workstation · /jarvis on|off · persona on|off · title <word>',
    })
    await refresh($)
    $.clock.every(REFRESH_MS, () => {
      void read($, telemetry).then(t => (t.isActive ? undefined : Promise.all([refresh($), syncLegion($)])))
    })
    if (p.enabled && !(await read($, greeted))) {
      await update($, greeted, () => true)
      const hour = new Date(await $.clock.now()).getHours()
      const part = hour < 5 ? 'evening' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
      $.ui.toast(`◉ Good ${part}, ${p.title}. J.A.R.V.I.S. online — all systems nominal.`, { timeoutMs: 5000 })
      void openDeck($, false)
    }
    return next(e)
  })

  // ── "jarvis on" / "jarvis off" typed at the prompt ───────────────────
  on('prompt.submit', async ($, e, next) => {
    const m = SWITCH.exec(e.text)
    if (!m) return next(e)
    const word = (m[1] ?? '').toLowerCase().replace(/\s+/g, ' ')
    if (word === 'off' || word === 'stand down' || word === 'offline') await standDown($)
    else if (word === 'dashboard' || word === 'status') {
      await refresh($)
      if (await isOn($)) $.ui.toast(await openDeck($, true))
      else $.ui.toast('J.A.R.V.I.S. is offline. Say "jarvis on" to bring the workstation up.')
    } else await engage($)
    return { drop: `jarvis ${word}` }
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const p = await read($, prefs)
    if (!p.enabled || !p.persona) return result
    return { sections: [...result.sections, { id: `${P}:persona`, text: persona(p.title), scope: 'session' }] }
  })

  // ── Telemetry (context, throughput, agents by model) ─────────────────
  on('turn.start', async ($, e, next) => {
    startedAt = await $.clock.now()
    chars = 0
    samples = []
    ticks = 0
    await update($, telemetry, s => ({ ...s, isActive: true, tps: 0, outTokens: 0 }))
    stopTicker?.()
    const timer = $.clock.every(250, async () => {
      const now = await $.clock.now()
      ticks += 1
      samples.push([now, chars / 4])
      samples = samples.filter(([t]) => now - t <= 2000)
      const [t0, c0] = samples[0] ?? [now, 0]
      const span = (now - t0) / 1000
      const tps = span > 0.2 ? (chars / 4 - c0) / span : 0
      const ctx = ticks % 4 === 1 ? (await $.session.usage()).context : undefined
      await syncLegion($)
      await update($, telemetry, s => ({
        ...s, tps, outTokens: Math.round(chars / 4),
        ctxPercent: ctx?.percent ?? s.ctxPercent,
        ctxTokens: ctx?.tokens ?? s.ctxTokens,
        ctxWindow: ctx?.window ?? s.ctxWindow,
      }))
    })
    stopTicker = () => timer.cancel()
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const isNew = !agents.has(e.agentId)
      agents.set(e.agentId, { model: e.model, seen: await $.clock.now() })
      if (isNew) await syncLegion($)
    }
    const it = next(e)[Symbol.asyncIterator]()
    for (;;) {
      const r = await it.next()
      if (r.done) return r.value
      const c = r.value
      if (!e.agentId && (c.kind === 'text' || c.kind === 'thinking')) chars += c.text.length
      yield c
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      agents.delete(e.agentId)
      await syncLegion($)
      const d = (await read($, deploys)).find(x => x.agentId === e.agentId && x.status === 'run')
      if (d) await land($, d.id, d.type, e.reason === 'answer' ? 'ok' : 'err')
      return next(e)
    }
    stopTicker?.()
    stopTicker = undefined
    const secs = Math.max((await $.clock.now()) - startedAt, 1) / 1000
    const out = e.usage?.output_tokens ?? Math.round(chars / 4)
    await update($, telemetry, s => ({ ...s, isActive: false, outTokens: out, tps: out / secs }))
    await update($, awaiting, () => false)
    await refresh($)
    await alertLoad($)
    if (secs * 1000 >= LONG_MISSION_MS) {
      const p = await read($, prefs)
      await notify($, `◆ Mission complete in ${duration(secs * 1000)}, ${p.title}.`)
    }
    return next(e)
  })

  // ── Protocols, files, subagent uplinks, questions ────────────────────
  on('tool.call', async ($, e, next) => {
    const op: Op = { id: e.tool_use_id, tool: String(e.tool), label: gist(e as Record<string, unknown>), status: 'run' }
    await update($, ops, list => [...list, op].slice(-40))

    const isAgent = e.tool === 'Agent'
    if (isAgent) {
      const d: Deploy = { id: e.tool_use_id, type: e.subagent_type ?? 'general-purpose', description: e.description, status: 'run' }
      await update($, deploys, list => [...list, d])
      await notify($, `⇢ Deploying ${d.type.toUpperCase()}: ${d.description}`)
    }
    const isQuestion = e.tool === 'AskUserQuestion'
    if (isQuestion) {
      const p = await read($, prefs)
      await update($, awaiting, () => true)
      await notify($, `⚠ Your input is required, ${p.title}.`)
    }

    const ran = await next(e)
    const status: OpStatus = ran.deny !== undefined || ran.isError === true ? 'err' : 'ok'
    await update($, ops, list => list.map(o => (o.id === op.id ? { ...o, status } : o)))
    if (isQuestion) await update($, awaiting, () => false)
    if (isAgent) {
      const type = e.subagent_type ?? 'general-purpose'
      const rec = ran.result as { status?: string; agentId?: string; resolvedModel?: string } | undefined
      if (status === 'ok' && (rec?.status === 'async_launched' || rec?.status === 'remote_launched') && rec.agentId) {
        // Launched into the background: still airborne until its own turn.complete.
        const agentId = rec.agentId
        await update($, deploys, list => list.map(d => (d.id === op.id ? { ...d, agentId } : d)))
        if (!agents.has(agentId)) agents.set(agentId, { model: rec.resolvedModel ?? '', seen: await $.clock.now() })
        await syncLegion($)
      } else await land($, op.id, type, status)
    }
    const fields = e as { file_path?: unknown; notebook_path?: unknown }
    const path = fields.file_path ?? fields.notebook_path
    if (status === 'ok' && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(op.tool) && typeof path === 'string') {
      await update($, files, stored => {
        const list = roundsOf(stored)
        const prior = list.find(r => r.path === path)
        return [{ path, rounds: (prior?.rounds ?? 0) + 1 }, ...list.filter(r => r.path !== path)].slice(0, 20)
      })
    }
    return ran
  })

  // ── The transcript, restyled ─────────────────────────────────────────
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    return next({
      ...e,
      props: {
        ...e.props,
        questions: e.props.questions.map(q =>
          q && typeof q === 'object' && typeof (q as { question?: unknown }).question === 'string'
            ? { ...q, question: `◈ JARVIS ▸ ${(q as { question: string }).question}` }
            : q,
        ),
      },
    })
  })

  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'composer' } } }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const p = await read($, prefs)
    return (
      <Box flexDirection="row">
        <Text color={C.gold} bold>{`▸ ${p.title.toUpperCase()} `}</Text>
        <Text color={C.white}>{e.props.text}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!e.props.isFirstOfReply || !(await isOn($))) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={C.arc} bold>{'◉ J.A.R.V.I.S'}</Text>
          <Text color={C.arcDeep}>{' ─────'}</Text>
        </Text>
        <Markdown text={e.props.text} />
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    if (e.surface !== 'terminal') return next({ ...e, props: { ...e.props, word: 'J.A.R.V.I.S. processing' } })
    const list = await read($, ops)
    const last = list[list.length - 1]
    const op = last && last.status === 'run' && last.tool !== 'Agent' ? { tool: last.tool, label: last.label } : null
    const { Client } = $.ui.resolve(e)
    return (
      <Client
        key="reactor"
        module="./reactor.tsx"
        width={e.viewport?.columns}
        props={{ mode: e.props.mode, message: e.props.message, op }}
      />
    )
  })

  // Idle, the band is the one JARVIS line (status and gauges). While a turn
  // runs the spinner line carries those, and the band shows only what the
  // spinner cannot: subagent uplinks and the input alert, or nothing.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await isOn($))) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const t = await read($, telemetry)
    const ds = await read($, deploys)
    const ask = await read($, awaiting)
    if (t.isActive && ds.length === 0 && !ask) return next(e)
    const p = await read($, prefs)
    const { Client } = $.ui.resolve(e)
    return (
      <Client
        key="hud"
        module="./hud.tsx"
        width={e.props.bodyColumns}
        props={{ isActive: t.isActive, load: t.ctxPercent, deploys: ds, awaiting: ask, title: p.title }}
      />
    )
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => {
    const input = (e.props.input ?? {}) as { description?: string; subagent_type?: string }
    if (!input.description || !(await isOn($))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // A background launch's tool use finishes at once; its deploy says whether it still flies.
    const deploy = (await read($, deploys)).find(d => d.id === e.props.tool_use_id)
    const [state, color] = e.props.isInterrupted
      ? ['⊘ RECALLED', C.gold]
      : e.props.isErrored || deploy?.status === 'err'
        ? ['✗ MISSION FAILED', C.red]
        : e.props.isRunning || deploy?.status === 'run'
          ? ['● DEPLOYED · UPLINK OPEN', C.gold]
          : ['✓ MISSION COMPLETE · INTEL RECEIVED', C.ok]
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={C.arc} bold>{'◆ SUBAGENT '}</Text>
          <Text color={C.arcDim}>{'▸ '}</Text>
          <Text color={C.white} bold>{(input.subagent_type ?? 'general-purpose').toUpperCase()}</Text>
          <Text color={C.arcDim}>{' · ' + input.description}</Text>
        </Box>
        <Box flexDirection="row">
          <Text color={C.arcDeep}>{'  ⤷ ━━━━━━━━━━━━ '}</Text>
          <Text color={color} bold>{state}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, telemetry)
    const p = await read($, prefs)
    return (
      <Box flexDirection="row">
        <Text color={C.arc}>{'◆ '}</Text>
        <Text color={C.white} bold>{'PROTOCOL COMPLETE'}</Text>
        <Text color={C.arcDim}>{` · ${duration(e.props.durationMs)} · ${k(t.outTokens)} tokens · `}</Text>
        <Text color={C.arcDim} italic>{`Standing by, ${p.title}.`}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    return next({ ...e, props: { ...e.props, tail: e.props.isWorking ? '◉ JARVIS engaged' : '◉ JARVIS online · "jarvis off" to stand down' } })
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, 'J.A.R.V.I.S.'] } })
  })

  // ── /jarvis ──────────────────────────────────────────────────────────
  on('command.run', { command: 'jarvis' }, async ($, e) => {
    const [cmd = '', ...rest] = (e.args ?? '').trim().split(/\s+/)
    const arg = rest.join(' ')
    if (cmd === 'off') {
      await standDown($)
      return { text: 'Standing down. Default Claude Code interface restored. Say "jarvis on" to bring me back.' }
    }
    if (cmd === 'on') {
      await engage($)
      return { text: 'Workstation online.' }
    }
    if (cmd === 'persona') {
      await savePrefs($, { persona: arg !== 'off' })
      return { text: `Persona ${arg === 'off' ? 'disengaged' : 'engaged'} (applies from the next request).` }
    }
    if (cmd === 'title' && arg) {
      await savePrefs($, { title: arg })
      return { text: `Very good. I shall address you as "${arg}".` }
    }
    if (!(await isOn($))) await savePrefs($, { enabled: true })
    await refresh($)
    const said = await openDeck($, true)
    return { text: `${said} Type "jarvis off" to return to the default interface.` }
  })

  // ── The workstation console ──────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, telemetry)
    const proj = await read($, project)
    const ds = await read($, deploys)
    const list = await read($, ops)
    const ammo = roundsOf(await read($, files))
    const p = await read($, prefs)
    const cols = e.props.bodyColumns
    const LABEL = 17
    const room = Math.max(12, cols - LABEL - 2)
    const cut = (s: string, n = room) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
    const tail = (s: string, n = room) => (s.length > n ? '…' + s.slice(s.length - n + 1) : s)
    const home = (s: string) => s.replace(/^\/Users\/[^/]+/, '~')
    const glyph = (s: OpStatus) => (s === 'run' ? '●' : s === 'ok' ? '✓' : '✗')
    const tone = (s: OpStatus) => (s === 'run' ? C.gold : s === 'ok' ? C.ok : C.red)

    const row = (label: string, value: RenderNode, color: string = C.white) => (
      <Box flexDirection="row">
        <Text color={C.arcDim}>{label.padEnd(LABEL)}</Text>
        {typeof value === 'string' ? <Text color={color} wrap="truncate-end">{value}</Text> : value}
      </Box>
    )
    const heading = (title: string) => (
      <Text>
        <Text color={C.arc} bold>{`▸ ${title} `}</Text>
        <Text color={C.arcDeep}>{'─'.repeat(Math.max(2, cols - title.length - 3))}</Text>
      </Text>
    )

    const load = t.ctxPercent
    const loadTone = load >= 85 ? C.red : load >= 60 ? C.gold : C.arc
    const loadWord = load >= 85 ? 'CRITICAL' : load >= 60 ? 'RUNNING HOT' : 'STABLE'
    const gauge = 12
    const lit = Math.max(0, Math.min(gauge, Math.round((load / 100) * gauge)))
    const suits = Math.max(t.opus + t.sonnet + t.haiku, ds.filter(d => d.status === 'run').length)

    let reactor: RenderNode = <Text color={C.arc}>◉</Text>
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      reactor = <Client key="arc" module="./arc.tsx" props={{ isActive: t.isActive }} />
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection={cols >= 50 ? 'row' : 'column'} gap={2}>
          {reactor}
          <Box flexDirection="column">
            <Text color={C.white} bold>{'J.A.R.V.I.S.'}</Text>
            <Text color={C.arcDim}>{'Just A Rather Very'}</Text>
            <Text color={C.arcDim}>{'Intelligent System'}</Text>
            <Text> </Text>
            <Text color={!p.enabled ? C.arcDim : t.isActive ? C.gold : C.ok} bold>
              {!p.enabled ? '○ OFFLINE' : t.isActive ? '● IN FLIGHT' : '● HOVERING'}
            </Text>
            <Text color={C.arcDim}>{t.isActive ? 'Engaging target' : `Awaiting orders, ${p.title}`}</Text>
          </Box>
        </Box>
        <Text> </Text>
        {heading('ARMOR DIAGNOSTICS')}
        {row(
          'Suit Status',
          t.isActive ? 'In flight · engaging target' : 'Hovering · awaiting orders',
          t.isActive ? C.gold : C.ok,
        )}
        {row('Neural Core', t.model ? `${t.model} · ${markOf(t.model)}` : 'Booting…')}
        {row(
          'Reactor Load',
          <Text>
            <Text color={loadTone}>{'█'.repeat(lit)}</Text>
            <Text color={C.grid}>{'░'.repeat(gauge - lit)}</Text>
            <Text color={loadTone} bold>{` ${Math.round(load)}% ${loadWord}`}</Text>
            <Text color={C.arcDim}>{t.ctxWindow ? `  ${k(t.ctxTokens)}/${k(t.ctxWindow)} tokens` : ''}</Text>
          </Text>,
        )}
        {row(
          'Repulsor Output',
          t.outTokens || t.tps
            ? `${t.tps.toFixed(1)} tok/s · ${k(t.outTokens)} tokens fired ${t.isActive ? 'this sortie' : 'last sortie'}`
            : 'Repulsors cold · no shots fired',
        )}
        {row(
          'Iron Legion',
          suits ? `${suits} suits airborne · Opus ${t.opus} · Sonnet ${t.sonnet} · Haiku ${t.haiku}` : 'All suits docked',
          suits ? C.gold : C.white,
        )}
        {row('Missions Flown', t.turns === 1 ? '1 directive this session' : `${t.turns} directives this session`)}
        {t.costUsd !== null && row('Stark Expenses', `$${t.costUsd.toFixed(2)} · Pepper has been notified`)}
        {t.rateLimit !== '' && row('S.H.I.E.L.D. Quota', t.rateLimit)}
        {row(
          'Voice Protocol',
          p.persona ? `J.A.R.V.I.S. · calls you "${p.title}"` : 'Muted · plain Claude voice',
          p.persona ? C.ok : C.arcDim,
        )}
        <Text> </Text>
        {heading('BASE OF OPERATIONS')}
        {row('Base Location', `${baseOf(proj.cwd)} ▸ ${tail(home(proj.cwd) || '—', Math.max(8, room - 20))}`)}
        {row('Armory', proj.repo ? `${proj.repo} · git vault sealed` : 'No git vault · off the grid')}
        <Text> </Text>
        {heading('IRON LEGION DEPLOYMENTS')}
        {ds.length === 0 && <Text color={C.arcDim}>{'  All suits docked in the Hall of Armor.'}</Text>}
        {ds.map(d => (
          <Text>
            <Text color={tone(d.status)}>{`  ${glyph(d.status)} `}</Text>
            <Text color={C.white} bold>{d.type.toUpperCase()}</Text>
            <Text color={C.arcDim}>{' · ' + cut(d.description, Math.max(8, cols - d.type.length - 8))}</Text>
          </Text>
        ))}
        <Text> </Text>
        {heading('MUNITIONS RELOADED')}
        {ammo.length === 0 && <Text color={C.arcDim}>{'  Magazine full. Not a single round fired yet.'}</Text>}
        {ammo.slice(0, 6).map(a => {
          const name = a.path.split('/').pop() ?? a.path
          return (
            <Text>
              <Text color={C.gold}>{'  ⁍ '}</Text>
              <Text color={C.white} bold>{cut(name, Math.max(8, cols - 30))}</Text>
              <Text color={C.arcDim}>{` ━ ${reloadWord(a.rounds)} ×${a.rounds}`}</Text>
            </Text>
          )
        })}
        {ammo.length > 6 && <Text color={C.arcDim}>{`  …and ${ammo.length - 6} more rounds in the chamber`}</Text>}
        <Text> </Text>
        {heading('MISSION LOG')}
        {list.length === 0 && <Text color={C.arcDim}>{'  Quiet skies. No protocols executed.'}</Text>}
        {list.slice(-8).map(o => (
          <Text>
            <Text color={tone(o.status)}>{`  ${glyph(o.status)} `}</Text>
            <Text color={C.gold}>{o.tool.padEnd(11)}</Text>
            <Text color={C.arcDim}>{cut(o.label, Math.max(8, cols - 16))}</Text>
          </Text>
        ))}
        <Text> </Text>
        {heading('HOLO CONTROLS')}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button
            key="brief"
            hotkey="1"
            label="Sitrep"
            variant="primary"
            onPress={() =>
              void $.prompt.submit({
                text: 'Sitrep: in a few lines, where are we, what changed this session, and what is next?',
              })
            }
          />
          <Button
            key="persona"
            hotkey="2"
            label={p.persona ? 'Mute voice' : 'Voice on'}
            onPress={() => void savePrefs($, { persona: !p.persona })}
          />
          <Button key="off" hotkey="3" label="Stand down" onPress={() => void standDown($)} />
        </Box>
      </Box>
    )
  })
}
