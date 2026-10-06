import type { ClientModule, RenderNode } from 'claude-code'

import { C, PHRASES, clock, mix } from './theme'

// The one JARVIS line while a turn runs, kept short: a spinning reactor,
// what it is doing, a small scanner, a phrase typed out (or the tool
// actually running) and the time.
type Props = {
  mode: string
  message: string | null
  op: { tool: string; label: string } | null
}
type State = { tick: number }

const MS = 80
const RING = ['◴', '◷', '◶', '◵']
const SCAN = 5
const WORD: Record<string, string> = {
  thinking: 'THINKING',
  requesting: 'UPLINK',
  responding: 'REPLYING',
  'tool-input': 'TARGETING',
  'tool-use': 'PROTOCOL',
}

const Reactor: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(MS, () => surface.setState({ tick: (surface.state?.tick ?? 0) + 1 }))
    surface.setState({ tick: 0 })
  }
  const tick = surface.state?.tick ?? 0
  const cols = surface.columns || 80
  const mode = props.mode in WORD ? props.mode : 'thinking'
  const isTool = (mode === 'tool-use' || mode === 'tool-input') && props.op !== null
  const label = isTool && props.op ? props.op.tool.toUpperCase() : (WORD[mode] ?? 'THINKING')
  const time = clock(tick, MS)

  const meter: RenderNode[] = []
  const span = SCAN * 2 - 2
  const p = tick % span
  const head = p < SCAN ? p : span - p
  for (let i = 0; i < SCAN; i++) {
    const d = Math.abs(i - head)
    meter.push(<Text color={d === 0 ? C.white : d === 1 ? C.arc : C.arcDeep}>{d <= 1 ? '▰' : '▱'}</Text>)
  }

  let text: string
  let caret = ''
  if (props.message) text = props.message
  else if (isTool && props.op) text = props.op.label
  else {
    const phrases = PHRASES[mode] ?? PHRASES.thinking ?? ['Working']
    const phrase = phrases[Math.floor(tick / 40) % phrases.length] ?? ''
    text = phrase.slice(0, (tick % 40) + 1)
    caret = text.length < phrase.length ? '▌' : '…'
  }
  const room = Math.max(4, cols - (11 + label.length + 1 + SCAN + 2 + time.length + 2))
  if (text.length + caret.length > room) {
    text = text.slice(0, Math.max(1, room - 1)) + '…'
    caret = ''
  }

  return (
    <Box flexDirection="row">
      <Text color={mix(C.arcDim, C.arc, (Math.sin(tick / 3) + 1) / 2)} bold>{RING[tick % RING.length]}</Text>
      <Text color={C.white} bold>{' JARVIS '}</Text>
      <Text color={C.arcDim}>{'▸ '}</Text>
      <Text color={isTool ? C.gold : C.arc} bold>{label}</Text>
      <Text>{' '}</Text>
      <Text>{meter}</Text>
      {text !== '' && <Text color={C.white}>{' ' + text}</Text>}
      <Text color={C.arc}>{caret}</Text>
      <Text color={C.arcDim}>{'  ' + time}</Text>
    </Box>
  )
}

export default Reactor
