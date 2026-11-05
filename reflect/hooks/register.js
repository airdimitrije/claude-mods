// reflect: catches a hard standing rule in a prompt and asks where to keep it

const PANE = 'reflect'
const MODEL = 'claude-haiku-4-5-20251001'
// A cheap prefilter, so the model is only called on something that looks
// like a standing rule rather than a one-off ask
const HINT = /\b(never|always|don't|do not|stop|from now on|make sure|no more|keep .* under)\b|nikad(a)?|uvijek|ne koristi|nemoj|od sada|obavezno|prestani/i

// Fixed destinations: this mod runs on one machine for one person
const MEMORY_DIR = 'C:\\Users\\LEGION\\.claude\\projects\\C--Users-LEGION\\memory'
const CLAUDE_MD = 'C:\\Users\\LEGION\\.claude\\CLAUDE.md'
const VAULT_INBOX = 'C:\\Users\\LEGION\\Documents\\Brain\\Inbox.md'

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

let isOn = true
// The one rule waiting for a decision, or null
let pending = null

function slugify(text) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug === '' ? 'reflect-rule' : slug
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function detectRule($, text) {
  try {
    const answer = await $.model.complete({
      model: MODEL,
      system:
        'You read one chat message and decide if it states a hard standing rule the assistant ' +
        'should always follow from now on (not a one-off request about this message only). ' +
        'If it does, answer with that rule as one short imperative sentence, in the language it was ' +
        'written in, and nothing else. If it does not, answer with exactly: NO',
      prompt: text,
      maxTokens: 120,
    })
    if (!answer.isAnswered) return ''
    const said = answer.text.trim()
    return said.toUpperCase() === 'NO' ? '' : said
  } catch (err) {
    return ''
  }
}

async function checkPrompt($, text) {
  if (pending !== null || !HINT.test(text)) return
  const rule = await detectRule($, text)
  if (rule === '') return
  pending = { rule }
  try {
    await $.ui.open({ id: PANE, title: 'Reflect', focus: true, closeOnEscape: true })
  } catch (err) {
    $.ui.log('reflect: panel not opened: ' + err.message)
  }
  $.ui.invalidate('ui.render')
}

async function saveToMemory($, rule) {
  const slug = slugify(rule) + '-' + today()
  const file =
    '---\n' +
    'name: ' + slug + '\n' +
    'description: ' + rule + '\n' +
    'metadata:\n' +
    '  type: feedback\n' +
    '---\n\n' +
    rule + '\n\n' +
    '**Why:** rečeno u ćaskanju, uhvatio reflect.\n' +
    '**How to apply:** ' + rule + '\n'
  await $.fs.write(MEMORY_DIR + '/' + slug + '.md', file)
  const index = await $.fs.read(MEMORY_DIR + '/MEMORY.md')
  await $.fs.write(MEMORY_DIR + '/MEMORY.md', index.trimEnd() + '\n- [' + rule + '](' + slug + '.md) — uhvatio reflect\n')
}

async function saveToClaudeMd($, rule) {
  const current = await $.fs.read(CLAUDE_MD)
  await $.fs.write(CLAUDE_MD, current.trimEnd() + '\n\n## ' + today() + ' — reflect\n\n' + rule + '\n')
}

async function saveToVault($, rule) {
  const current = await $.fs.read(VAULT_INBOX)
  await $.fs.write(VAULT_INBOX, current.trimEnd() + '\n- [' + today() + ' - reflect] ' + rule + '\n')
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await readSwitch($)
    $.clock.every(3000, () => readSwitch($))
    const saved = await $.store.get('isOn')
    if (typeof saved === 'boolean') isOn = saved
    try {
      await $.command.register({ name: 'reflect', description: 'Turn the standing-rule catcher on or off' })
    } catch (err) {
      $.ui.log('reflect: /reflect not registered: ' + err.message)
    }
    return next(e)
  })

  on('command.run', { command: 'reflect' }, async ($) => {
    if (isOff) return { text: 'reflect is turned off in /mods.' }
    isOn = !isOn
    await $.store.set('isOn', isOn)
    return { text: isOn ? 'Watching prompts for standing rules.' : 'reflect off.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isOff && isOn) {
      // Scheduled so the model call never holds this turn
      $.clock.after(0, () => checkPrompt($, e.text))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (pending === null) {
      return Box({ children: [Text({ dimColor: true, children: ['Nothing waiting.'] })] })
    }
    const close = () => {
      pending = null
      $.ui.invalidate('ui.render')
      $.ui.close(PANE).catch(() => {})
    }
    const rule = pending.rule
    const saveAs = async (label, err) => {
      if (err === undefined) $.ui.toast('Saved to ' + label)
      else $.ui.toast('Could not save: ' + err.message)
      close()
    }
    return Box({
      flexDirection: 'column',
      children: [
        Text({ children: ['Pravilo: ' + rule] }),
        Text({ children: [' '] }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({
              key: 'memory',
              label: 'Memory',
              hotkey: 'm',
              onPress: async () => {
                try {
                  await saveToMemory($, rule)
                  await saveAs('memory')
                } catch (err) {
                  await saveAs('memory', err)
                }
              },
            }),
            Button({
              key: 'claude',
              label: 'CLAUDE.md',
              hotkey: 'c',
              onPress: async () => {
                try {
                  await saveToClaudeMd($, rule)
                  await saveAs('CLAUDE.md')
                } catch (err) {
                  await saveAs('CLAUDE.md', err)
                }
              },
            }),
            Button({
              key: 'vault',
              label: 'Vault',
              hotkey: 'v',
              onPress: async () => {
                try {
                  await saveToVault($, rule)
                  await saveAs('the vault')
                } catch (err) {
                  await saveAs('the vault', err)
                }
              },
            }),
            Button({ key: 'skip', label: 'Skip', hotkey: 's', onPress: close }),
          ],
        }),
      ],
    })
  })
}
