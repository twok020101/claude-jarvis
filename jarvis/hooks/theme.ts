// Stark Industries HUD palette.
export const C = {
  arc: '#00E5FF',
  arcDim: '#0A6E80',
  arcDeep: '#06343D',
  gold: '#FFC940',
  red: '#E62429',
  white: '#E8FBFF',
  ok: '#3DFFB0',
  grid: '#1C3A44',
} as const

export type Seg = { t: string; c?: string; b?: boolean }

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Blends two #rrggbb colors; t in [0, 1].
export const mix = (a: string, b: string, t: number) => {
  const p = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16)
  const ch = (i: number) =>
    Math.round(lerp(p(a, i), p(b, i), Math.max(0, Math.min(1, t))))
      .toString(16)
      .padStart(2, '0')
  return `#${ch(1)}${ch(3)}${ch(5)}`
}

export const k = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`

export const clock = (ticks: number, ms: number) => {
  const s = Math.floor((ticks * ms) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export const MODE_LABEL: Record<string, string> = {
  thinking: 'COGNITIVE CORE',
  requesting: 'UPLINK',
  responding: 'TRANSMITTING',
  'tool-input': 'TARGETING',
  'tool-use': 'PROTOCOL ACTIVE',
}

export const PHRASES: Record<string, readonly string[]> = {
  thinking: [
    'Running Stark heuristics',
    'Simulating 14,000,605 futures',
    'Consulting the Tesseract',
    'Cross-referencing S.H.I.E.L.D. archives',
    'Charging arc reactor',
    'Recalibrating neural matrix',
  ],
  requesting: ['Establishing satellite uplink', 'Handshaking with Stark servers', 'Routing through Avengers Tower'],
  responding: ['Composing response, sir', 'Rendering holographic output', 'Projecting heads-up display'],
  'tool-input': ['Acquiring target', 'Locking coordinates', 'Plotting trajectory'],
  'tool-use': ['Deploying Mark LXXXV nanites', 'Calibrating repulsors', 'Engaging House Party Protocol', 'Executing protocol'],
}
