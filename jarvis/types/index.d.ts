export type Telemetry = {
  isActive: boolean
  tps: number
  outTokens: number
  ctxPercent: number
  ctxTokens: number
  ctxWindow: number
  opus: number
  sonnet: number
  haiku: number
  model: string
  turns: number
  costUsd: number | null
  rateLimit: string
  // Prompt-cache tokens this session, every loop's turns summed: hits read
  // from cache; misses written to it or sent uncached.
  cacheHit: number
  cacheMiss: number
}

export type Project = { cwd: string; repo: string | null }

// A file Claude edited: a round reloaded, as many times as it was edited.
export type Round = { path: string; rounds: number }

export type OpStatus = 'run' | 'ok' | 'err'

export type Op = { id: string; tool: string; label: string; status: OpStatus }

export type Deploy = {
  id: string
  type: string
  description: string
  status: OpStatus
  // Set for a background launch: the subagent's own turn.complete settles it.
  agentId?: string
}

// `enabled` is workstation mode: off, every hook passes and Claude Code
// looks as it does without the mod.
export type Prefs = { enabled: boolean; persona: boolean; title: string }

declare module 'claude-code' {
  interface PluginState {
    jarvis: {
      telemetry: Telemetry
      project: Project
      ops: Op[]
      files: Round[]
      deploys: Deploy[]
      awaiting: boolean
      prefs: Prefs
      greeted: boolean
      loadAlert: number
    }
  }
}
