export type Status = 'radi' | 'čeka tebe' | 'traži dozvolu' | 'nova'

// One session's heartbeat, as written to <home>/.claude/session-board/<id>.json
export type Beat = {
  id: string
  project: string
  cwd: string
  status: Status
  title: string
  tokens: number
  percent: number
  changedAt: number
  aliveAt: number
  isClosed?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    tabla: { rows: Shaped<Beat[]> }
  }
}
