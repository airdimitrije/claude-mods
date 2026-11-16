import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Beat, Status } from '../types'

// tabla: every open session writes a small heartbeat file into one shared
// folder; /tabla opens a pane that reads that folder and shows all of them.
// The phone push goes through the PushNotification tool (Remote Control).

const PANE = 'tabla'
const ALIVE_MS = 60_000 // heartbeat touch
const STALE_MS = 3 * 60_000 // hidden after this long without a touch
const REFRESH_MS = 3_000 // pane re-read while open
const LONG_TURN_MS = 2 * 60_000 // push only for turns at least this long
const ORDER: Record<Status, number> = { 'traži dozvolu': 0, 'čeka tebe': 1, radi: 2, nova: 3 }

const rows = atom({ plugin: 'tabla', key: 'rows' } as const, [], { shape: 'rows-1' })

let dir = ''
let me: Beat | undefined
let paneOpen = false
let refreshing: { cancel(): void } | undefined
let turnStartedAt = 0

const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

async function homeDir($: any): Promise<string> {
  const r = await $.process.run(['node', '-p', "require('os').homedir()"], { timeoutMs: 10_000 })
  return r.stdout.trim().replace(/\\/g, '/')
}

async function save($: any, patch: Partial<Beat>) {
  if (!me || !dir) return
  const now = Date.now()
  const changed = patch.status !== undefined && patch.status !== me.status
  me = { ...me, ...patch, aliveAt: now, changedAt: changed ? now : me.changedAt }
  try {
    const u = await $.session.usage()
    me.tokens = u?.context?.tokens ?? me.tokens
    me.percent = u?.context?.percent ?? me.percent
  } catch {}
  await $.fs.write(`${dir}/${me.id}.json`, JSON.stringify(me))
  if (paneOpen) await refresh($)
}

export async function loadBoard($: any, folder: string, now: number): Promise<Beat[]> {
  const entries = await $.fs.list(folder).catch(() => [])
  const out: Beat[] = []
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    try {
      const b = JSON.parse(await $.fs.read(`${folder}/${f.name}`)) as Beat
      if (!b.isClosed && now - b.aliveAt < STALE_MS) out.push(b)
    } catch {}
  }
  return out.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.changedAt - a.changedAt)
}

async function refresh($: any) {
  if (!dir) return
  const list = await loadBoard($, dir, Date.now())
  await update($, rows, () => list)
}

async function pushOn($: any): Promise<boolean> {
  return ((await $.store.get('push')) ?? 'on') === 'on'
}

async function push($: any, message: string) {
  if (!(await pushOn($))) return
  try {
    await $.tool.call({ tool: 'PushNotification', message: message.slice(0, 190) })
  } catch {
    // No Remote Control, or the tool is missing on this machine: the pane still works.
  }
}

function openPane($: any) {
  paneOpen = true
  refreshing?.cancel()
  refreshing = $.clock.every(REFRESH_MS, () => void refresh($))
  return $.ui.open({ id: PANE, title: 'Tabla sesija' })
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'tabla',
      description: 'Tabla svih otvorenih sesija; /tabla push on|off za notifikacije na telefon',
    })
    try {
      const home = await homeDir($)
      dir = `${home}/.claude/session-board`
      const cwd = String(e.cwd ?? (await $.session.cwd()))
      const id = await $.session.id()
      const now = Date.now()
      me = { id, project: base(cwd), cwd, status: 'nova', title: '', tokens: 0, percent: 0, changedAt: now, aliveAt: now }
      await save($, {})
      $.clock.every(ALIVE_MS, () => void save($, {}))
      // Files from sessions that died without session.end: drop the ones older than 2 days.
      void $.process.run(
        ['node', '-e', "const fs=require('fs'),p=require('path'),d=process.argv[1],t=Date.now()-2*864e5;for(const f of fs.readdirSync(d)){const q=p.join(d,f);try{if(fs.statSync(q).mtimeMs<t)fs.unlinkSync(q)}catch{}}", dir],
        { timeoutMs: 10_000 },
      ).catch(() => {})
    } catch (err) {
      $.ui.log(`tabla: no heartbeat (${String(err)})`, { to: 'debug' })
    }
    return started
  })

  on('command.run', { command: 'tabla' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg === 'push on' || arg === 'push off') {
      await $.store.set('push', arg.slice(5))
      return { text: `Push na telefon: ${arg.slice(5)}.` }
    }
    if (arg === 'push') return { text: `Push na telefon: ${(await pushOn($)) ? 'on' : 'off'}.` }
    await refresh($)
    await openPane($)
    return { text: 'Tabla otvorena.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command) {
      turnStartedAt = Date.now()
      const title = me?.title || String(e.text ?? '').replace(/\s+/g, ' ').slice(0, 60)
      await save($, { status: 'radi', title }).catch(() => {})
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // never hold a prompt back because the board failed

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId || !me) return done
    await save($, { status: 'čeka tebe' }).catch(() => {})
    const took = e.durationMs ?? Date.now() - turnStartedAt
    if (took >= LONG_TURN_MS && !e.isAborted) {
      const answer = String(e.answer ?? '').replace(/\s+/g, ' ').trim()
      await push($, `${me.project}: gotovo (${ago(took)}) — ${answer.slice(0, 120)}`)
    }
    return done
  })

  on('classic.Notification', async ($, e, next) => {
    const r = await next(e)
    if (e.notification_type === 'permission_prompt' && me) {
      await save($, { status: 'traži dozvolu' }).catch(() => {})
      await push($, `${me.project}: traži dozvolu — ${String(e.message ?? '').slice(0, 120)}`)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await save($, { isClosed: true }).catch(() => {})
    refreshing?.cancel()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, rows)
    const now = Date.now()
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 3)
    const color = (s: Status) => (s === 'traži dozvolu' ? 'red' : s === 'čeka tebe' ? 'yellow' : s === 'radi' ? 'green' : undefined)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>Nema otvorenih sesija.</Text>}
        {list.slice(0, room).map(b => (
          <Box flexDirection="column">
            <Text>
              <Text bold>{b.project}</Text>
              {b.id === me?.id ? ' (ova)' : ''} <Text color={color(b.status)}>{b.status}</Text>{' '}
              <Text dimColor>
                {ago(now - b.changedAt)} · {Math.round(b.tokens / 1000)}k ({Math.round(b.percent)}%)
              </Text>
            </Text>
            {b.title ? <Text dimColor>  {b.title}</Text> : null}
          </Box>
        ))}
      </Box>
    )
  })
}
