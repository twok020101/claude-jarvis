import type { ClientModule, RenderNode } from 'claude-code'

import type { Deploy } from '../types'
import { C, mix } from './theme'

// The band above the prompt, kept to the least: one idle status line, one
// short uplink per subagent, and the alert while a question waits.
type Props = { isActive: boolean; load: number; deploys: Deploy[]; awaiting: boolean; title: string }
type State = { tick: number }

const MS = 90
const PIPE = 8

// The frame each uplink was first drawn on, by tool_use_id.
const seen: Record<string, number> = {}

const Hud: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(MS, () => surface.setState({ tick: (surface.state?.tick ?? 0) + 1 }))
    surface.setState({ tick: 0 })
  }
  const tick = surface.state?.tick ?? 0
  const cols = surface.columns || 80
  const rows: RenderNode[] = []

  if (!props.isActive) {
    const load = Math.round(props.load)
    const tone = load >= 85 ? C.red : load >= 60 ? C.gold : C.arcDim
    rows.push(
      <Text>
        <Text color={mix(C.arcDim, C.arc, (Math.sin(tick / 8) + 1) / 2)} bold>{'◉'}</Text>
        <Text color={C.white} bold>{' JARVIS'}</Text>
        <Text color={C.arcDim}>{' online · reactor '}</Text>
        <Text color={tone}>{`${load}%`}</Text>
      </Text>,
    )
  }

  if (props.awaiting) {
    rows.push(
      <Text color={tick % 10 < 5 ? C.red : C.gold} bold>
        {`⚠ Awaiting your directive, ${props.title}.`}
      </Text>,
    )
  }

  for (const d of props.deploys) {
    if (seen[d.id] === undefined) seen[d.id] = tick
    const age = tick - (seen[d.id] ?? tick)
    const pipe: RenderNode[] = []
    for (let i = 0; i < PIPE; i++) {
      let ch = '━'
      let color: string = C.arcDeep
      if (d.status === 'err') color = C.red
      else if (d.status === 'ok') color = C.ok
      else if ((i - age + 100) % 4 === 0) [ch, color] = ['▶', C.arc]
      pipe.push(<Text color={color}>{ch}</Text>)
    }
    const [mark, markColor] = d.status === 'err' ? ['✗', C.red] : d.status === 'ok' ? ['✓', C.ok] : ['⇢', C.arc]
    const room = Math.max(6, cols - d.type.length - PIPE - 12)
    const desc = d.description.length > room ? d.description.slice(0, room - 1) + '…' : d.description
    rows.push(
      <Text>
        <Text color={C.arcDim}>{'⤷ '}</Text>
        <Text color={C.white} bold>{d.type.toUpperCase() + ' '}</Text>
        <Text color={C.arcDim}>{'◆'}</Text>
        <Text>{pipe}</Text>
        <Text color={C.arcDim}>{'◆ '}</Text>
        <Text color={C.arcDim}>{desc + ' '}</Text>
        <Text color={markColor} bold>{mark}</Text>
      </Text>,
    )
  }

  return <Box flexDirection="column">{rows}</Box>
}

export default Hud
