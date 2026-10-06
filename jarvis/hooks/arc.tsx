import type { ClientModule, RenderNode } from 'claude-code'

import { C, mix } from './theme'

// A procedurally drawn arc reactor: a pulsing core, an inner ring spinning
// one way and an outer ring the other. Faster while a turn runs.
type Props = { isActive: boolean }
type State = { tick: number }

const W = 25
const H = 11
const MS = 70

const cell = (x: number, y: number, tick: number, fast: boolean): [string, string] => {
  const dx = (x - (W - 1) / 2) / 2.1
  const dy = y - (H - 1) / 2
  const r = Math.hypot(dx, dy)
  const a = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)
  const spin = tick / (fast ? 2 : 5)
  const pulse = (Math.sin(tick / (fast ? 2 : 5)) + 1) / 2

  if (r <= 1.15) return ['█', mix(C.arc, C.white, pulse)]
  if (r <= 2.1) return ['▓', mix(C.arcDim, C.arc, pulse)]
  if (r > 2.6 && r <= 3.5) {
    const seg = Math.floor(a * 10)
    const gap = (a * 10) % 1 > 0.78
    if (gap) return [' ', C.arcDeep]
    const lit = seg === Math.floor(spin) % 10
    return [lit ? '■' : '▪', lit ? C.white : C.arc]
  }
  if (r > 4.1 && r <= 5.2) {
    const pos = (a + spin / 24) % 1
    const head = Math.floor(pos * 24)
    const trail = head < 4 ? (4 - head) / 4 : 0
    return ['░▒▓█'[Math.min(3, Math.floor(trail * 4))] ?? '░', trail > 0 ? mix(C.arcDim, C.gold, trail) : C.arcDeep]
  }
  return [' ', C.arcDeep]
}

const Arc: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(MS, () => surface.setState({ tick: (surface.state?.tick ?? 0) + 1 }))
    surface.setState({ tick: 0 })
  }
  const tick = surface.state?.tick ?? 0
  const lines: RenderNode[] = []
  for (let y = 0; y < H; y++) {
    const runs: RenderNode[] = []
    let text = ''
    let color = ''
    for (let x = 0; x < W; x++) {
      const [ch, c] = cell(x, y, tick, props.isActive)
      if (c !== color && text) {
        runs.push(<Text color={color}>{text}</Text>)
        text = ''
      }
      color = c
      text += ch
    }
    if (text) runs.push(<Text color={color}>{text}</Text>)
    lines.push(<Text>{runs}</Text>)
  }
  // A live clock under the reactor, as on the workshop's wall display.
  const now = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const time = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`
  const date = `${days[now.getDay()]} ${two(now.getDate())} ${months[now.getMonth()]}`
  const pad = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
  return (
    <Box flexDirection="column">
      {lines}
      <Text color={C.white} bold>{pad(time)}</Text>
      <Text color={C.arcDim}>{pad(date)}</Text>
    </Box>
  )
}

export default Arc
