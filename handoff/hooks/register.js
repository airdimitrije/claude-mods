// handoff: writes tasks/handoff.md — the chat's own hand-off file — and lets
// Dimi's existing SessionStart hook (handoff-restore.ps1) pick it up after /clear

// Fires when the context reaches this size
const TOKEN_LIMIT = 250_000
// Or when nothing has been typed for this long: the same default TTL cache-clock
// assumes, kept here on its own because a plugin's $.store is private to it
const COLD_MS = 60 * 60 * 1000
// Never write twice within this long, so three triggers in a row don't triple-write
const MIN_GAP_MS = 2 * 60 * 1000
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

let isOff = false

async function readSwitch($) {
  const root = $.plugin.root
  const cut = Math.max(root.lastIndexOf('\\'), root.lastIndexOf('/'))
  try {
    const parsed = JSON.parse(await $.fs.read(root.slice(0, cut) + '/.mods-state.json'))
    isOff = Array.isArray(parsed.disabled) && parsed.disabled.includes($.plugin.name)
  } catch (err) {
    isOff = false
  }
}

let anchor = 0
let timer = null
let lastWriteAt = 0
let lastPath = ''
let lastNote = ''

function clearTimer() {
  if (timer !== null) timer.cancel()
  timer = null
}

function armCold($) {
  clearTimer()
  timer = $.clock.after(COLD_MS, () => doHandoff($, 'the chat went quiet for ' + Math.round(COLD_MS / 60000) + ' minutes'))
}

// Everything the handoff is built from: the task list and, scanned out of
// the transcript, which files were touched and which tools, skills and
// connectors were used
async function gather($) {
  let tasks = []
  try {
    tasks = (await $.tool.call({ tool: 'TaskList' })).result.tasks
  } catch (err) {
    tasks = []
  }
  const messages = await $.session.messages()
  const files = new Set()
  const tools = new Set()
  const skills = new Set()
  for (const message of messages) {
    for (const use of message.toolUses || []) {
      tools.add(use.name)
      if (typeof use.input?.file_path === 'string') files.add(use.input.file_path)
      if (use.name === 'Skill' && typeof use.input?.skill === 'string') skills.add(use.input.skill)
    }
  }
  return { tasks, messages, files: [...files], tools: [...tools], skills: [...skills] }
}

function transcriptText(messages) {
  return messages
    .map((message) => (message.role === 'user' ? 'User: ' : 'Claude: ') + message.text)
    .join('\n\n')
    .slice(-180_000)
}

async function cwd($) {
  try {
    const here = await $.session.cwd()
    return typeof here === 'string' ? here : here.path
  } catch (err) {
    return '.'
  }
}

async function doHandoff($, reason) {
  clearTimer()
  const now = await $.clock.now()
  if (now - lastWriteAt < MIN_GAP_MS) return
  const picture = await gather($)
  const facts =
    'Task list:\n' +
    picture.tasks.map((task) => '- [' + task.status + '] ' + task.subject).join('\n') +
    '\n\nTools used: ' + picture.tools.join(', ') +
    '\nSkills used: ' + (picture.skills.join(', ') || '(none)') +
    '\nFiles touched: ' + picture.files.join(', ') +
    '\n\nTranscript:\n' + transcriptText(picture.messages)

  let note = ''
  try {
    const answer = await $.model.fork({ prompt: PROMPT + '\n\n' + facts })
    note = answer.isAnswered ? answer.text.trim() : ''
  } catch (err) {
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
    lastNote = note
    $.ui.toast('Wrote ' + path + ' (' + reason + ')')
    $.ui.invalidate('ui.render')
  } catch (err) {
    $.ui.log('handoff: could not write ' + path + ': ' + err.message)
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await readSwitch($)
    $.clock.every(3000, () => readSwitch($))
    try {
      await $.command.register({ name: 'handoff', description: 'Write tasks/handoff.md from this chat now' })
    } catch (err) {
      $.ui.log('handoff: /handoff not registered: ' + err.message)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (isOff || e.agentId !== undefined) {
      return next(e)
    }
    anchor = await $.clock.now()
    armCold($)
    try {
      const usage = await $.session.usage()
      if (usage.context.tokens >= TOKEN_LIMIT) {
        await doHandoff($, 'the chat reached ' + Math.round(usage.context.tokens / 1000) + 'k tokens')
      }
    } catch (err) {
      // no usage to check this turn
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isOff && anchor !== 0) armCold($)
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($) => {
    if (isOff) return { text: 'handoff is turned off in /mods.' }
    await doHandoff($, 'you asked for it')
    return lastPath === ''
      ? { text: 'Could not write a handoff — see the debug log.' }
      : { text: 'Wrote ' + lastPath + '. /clear will bring it back automatically.' }
  })
}
