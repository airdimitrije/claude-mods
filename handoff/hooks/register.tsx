import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Offer } from '../types'

// handoff: writes tasks/handoff.md — the chat's own hand-off file — and lets
// Dimi's existing SessionStart hook (handoff-restore.ps1) pick it up after /clear.
// Past TOKEN_LIMIT a band above the prompt offers "Nova sesija": it writes the
// handoff, leaves a marker, and opens a new terminal tab with plain `claude`;
// the new session's first prompt carries the handoff as context. Nothing is
// typed or submitted for the person.

// Auto-compact runs at 160k, so the offer has to come well before it
const TOKEN_LIMIT = 110_000
// After "Ne sad", ask again only once the context grew this much more
const REOFFER_TOKENS = 30_000
// Or when nothing has been typed for this long: the same default TTL cache-clock
// assumes, kept here on its own because a plugin's $.store is private to it
const COLD_MS = 60 * 60 * 1000
// Never write twice within this long, so three triggers in a row don't triple-write
const MIN_GAP_MS = 2 * 60 * 1000
// A marker older than this is a leftover, not a hand-off in progress
const MARKER_MS = 15 * 60 * 1000
const MARKER = 'tasks/.handoff-pending'
const pendingKey = (dir: string) => 'pending:' + dir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
// A model good enough to write a careful brief, used through fork so the long
// read of the chat is served from the prompt cache instead of paid for cold
const PROMPT =
  'Write a hand-off note in Serbian (Montenegrin Latin) from everything above, for someone ' +
  'picking up this chat cold after /clear. Use exactly these six headings, each on its own line, ' +
  'in this order, with nothing before the first or after the last: ' +
  '"Zadatak", "Putanje", "Urađeno", "Sljedeće", "Odluke", "Zamke". ' +
  'Zadatak: what is being done, one sentence. Putanje: the files and folders in play. ' +
  'Urađeno: only what is actually verified, not merely written. Sljedeće: the first concrete step. ' +
  'Odluke: what was chosen and why, so it is not second-guessed from scratch. ' +
  'Zamke: what broke and how it was worked around. Keep every file path and fact exact. ' +
  'Be brief: never longer than a screen.'

const offer = atom({ plugin: 'handoff', key: 'offer' } as const, null)
const dismissedAt = atom({ plugin: 'handoff', key: 'dismissedAt' } as const, 0)

let isOff = false
let anchor = 0
let timer: { cancel(): void } | null = null
let lastWriteAt = 0
let lastPath = ''
let isFirstPrompt = true

async function readSwitch($: any) {
  const root: string = $.plugin.root
  const cut = Math.max(root.lastIndexOf('\\'), root.lastIndexOf('/'))
  try {
    const parsed = JSON.parse(await $.fs.read(root.slice(0, cut) + '/.mods-state.json'))
    isOff = Array.isArray(parsed.disabled) && parsed.disabled.includes($.plugin.name)
  } catch {
    isOff = false
  }
}

function clearTimer() {
  if (timer !== null) timer.cancel()
  timer = null
}

function armCold($: any) {
  clearTimer()
  timer = $.clock.after(COLD_MS, () => doHandoff($, 'the chat went quiet for ' + Math.round(COLD_MS / 60000) + ' minutes'))
}

// Everything the handoff is built from: the task list and, scanned out of
// the transcript, which files were touched and which tools, skills and
// connectors were used
async function gather($: any) {
  let tasks: any[] = []
  try {
    tasks = (await $.tool.call({ tool: 'TaskList' })).result.tasks
  } catch {
    tasks = []
  }
  const messages: any[] = await $.session.messages()
  const files = new Set<string>()
  const tools = new Set<string>()
  const skills = new Set<string>()
  for (const message of messages) {
    for (const use of message.toolUses || []) {
      tools.add(use.name)
      if (typeof use.input?.file_path === 'string') files.add(use.input.file_path)
      if (use.name === 'Skill' && typeof use.input?.skill === 'string') skills.add(use.input.skill)
    }
  }
  return { tasks, messages, files: [...files], tools: [...tools], skills: [...skills] }
}

function transcriptText(messages: any[]) {
  return messages
    .map(message => (message.role === 'user' ? 'User: ' : 'Claude: ') + message.text)
    .join('\n\n')
    .slice(-180_000)
}

async function cwd($: any): Promise<string> {
  try {
    const here = await $.session.cwd()
    return typeof here === 'string' ? here : here.path
  } catch {
    return '.'
  }
}

async function doHandoff($: any, reason: string) {
  clearTimer()
  const now = await $.clock.now()
  if (now - lastWriteAt < MIN_GAP_MS) return
  const picture = await gather($)
  const facts =
    'Task list:\n' +
    picture.tasks.map(task => '- [' + task.status + '] ' + task.subject).join('\n') +
    '\n\nTools used: ' + picture.tools.join(', ') +
    '\nSkills used: ' + (picture.skills.join(', ') || '(none)') +
    '\nFiles touched: ' + picture.files.join(', ') +
    '\n\nTranscript:\n' + transcriptText(picture.messages)

  let note = ''
  try {
    const answer = await $.model.fork({ prompt: PROMPT + '\n\n' + facts })
    note = answer.isAnswered ? answer.text.trim() : ''
  } catch {
    note = ''
  }
  if (note === '') {
    $.ui.log('handoff: the model did not answer, so tasks/handoff.md was not written')
    return
  }

  const path = (await cwd($)) + '/tasks/handoff.md'
  try {
    await $.fs.write(path, note + '\n')
    lastWriteAt = now
    lastPath = path
    $.ui.toast('Wrote ' + path + ' (' + reason + ')')
  } catch (err) {
    $.ui.log('handoff: could not write ' + path + ': ' + String((err as Error)?.message ?? err))
  }
}

// "Nova sesija": the handoff, the marker the next session looks for, and a new
// terminal tab in the same folder. Returns what to tell the person.
export async function startFresh($: any): Promise<string> {
  await doHandoff($, 'nova sesija')
  if (lastPath === '') return 'Handoff nije upisan, nova sesija nije otvorena — vidi debug log.'
  const here = await cwd($)
  const project = here.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'claude'
  const pending = { at: await $.clock.now(), from: await $.session.id() }
  await $.fs.write(`${here}/${MARKER}`, JSON.stringify(pending))
  // The same marker in this plugin's private store: a marker file that arrived
  // with a cloned repo or was written by anything else has no match there
  await $.store.set(pendingKey(here), pending)
  await update($, offer, () => null)
  try {
    const r = await $.process.run(
      ['wt.exe', '-w', '0', 'new-tab', '-d', here, '--title', `${project} (nastavak)`, 'cmd', '/k', 'claude'],
      { timeoutMs: 15_000 },
    )
    if (r.exitCode === 0) return `Nova sesija otvorena u novom tabu (${project}). Prvi prompt tamo dobija handoff kao kontekst.`
  } catch {}
  return `Handoff je upisan. Terminal nije otvoren: pokreni \`claude\` u ${here} u narednih 15 min i prvi prompt dobija handoff.`
}

// The new session's side: a fresh marker from another session hands over the note once.
export async function takeOver($: any): Promise<string | undefined> {
  const here = await cwd($)
  let marker: { at?: number; from?: string; isTaken?: boolean }
  try {
    marker = JSON.parse(await $.fs.read(`${here}/${MARKER}`))
  } catch {
    return undefined
  }
  const now = await $.clock.now()
  const age = now - (marker.at ?? 0)
  if (marker.isTaken || marker.from === (await $.session.id()) || age < 0 || age > MARKER_MS) return undefined
  const mine = (await $.store.get(pendingKey(here))) as { at?: number; from?: string } | null | undefined
  if (!mine || mine.at !== marker.at || mine.from !== marker.from) return undefined
  const note = String(await $.fs.read(`${here}/tasks/handoff.md`).catch(() => '')).trim()
  if (note.length < 20) return undefined
  await $.fs.write(`${here}/${MARKER}`, JSON.stringify({ ...marker, isTaken: true }))
  await $.store.set(pendingKey(here), null)
  return 'Predaja smjene iz tasks/handoff.md, upisana u prethodnoj sesiji prije ' +
    Math.max(1, Math.round((now - (marker.at ?? now)) / 60000)) +
    ' min. Ovo je stanje posla na kom je ta sesija stala — provjeri da li je još aktuelno prije nego nastaviš:\n\n' + note
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await readSwitch($)
    $.clock.every(3000, () => void readSwitch($))
    try {
      await $.command.register({ name: 'handoff', description: 'Upiši tasks/handoff.md sada; /handoff nova otvara novu sesiju sa njim' })
    } catch (err) {
      $.ui.log('handoff: /handoff not registered: ' + String((err as Error)?.message ?? err))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (isOff || e.agentId !== undefined) return next(e)
    anchor = await $.clock.now()
    armCold($)
    try {
      const tokens = (await $.session.usage()).context.tokens ?? 0
      if (tokens >= TOKEN_LIMIT && tokens >= (await read($, dismissedAt)) + REOFFER_TOKENS) {
        await update($, offer, () => ({ tokens, path: (lastPath || 'tasks/handoff.md') }))
      }
    } catch {
      // no usage to check this turn
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isOff && anchor !== 0) armCold($)
    if (isOff || !isFirstPrompt || e.command) return next(e)
    isFirstPrompt = false
    const note = await takeOver($)
    return next(note ? { ...e, context: [...(e.context ?? []), note] } : e)
  }).catch(($, e, next) => next(e)) // never hold a prompt back because the hand-off failed

  on('command.run', { command: 'handoff' }, async ($, e) => {
    if (isOff) return { text: 'handoff is turned off in /mods.' }
    if (String(e.args ?? '').trim().toLowerCase() === 'nova') return { text: await startFresh($) }
    await doHandoff($, 'you asked for it')
    return lastPath === ''
      ? { text: 'Could not write a handoff — see the debug log.' }
      : { text: 'Wrote ' + lastPath + '. /clear will bring it back automatically.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const o: Offer = await read($, offer)
    if (isOff || o === null || e.props.hasSurvey || e.props.isWorking) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="yellow">Kontekst {Math.round(o.tokens / 1000)}k (compaction na 160k). </Text>
        <Button
          key="fresh"
          label="Nova sesija"
          onPress={async () => $.ui.toast(await startFresh($))}
        />
        <Text> </Text>
        <Button
          key="later"
          label="Ne sad"
          onPress={async () => {
            await update($, dismissedAt, () => o.tokens)
            await update($, offer, () => null)
          }}
        />
      </Box>
    )
  })
}
