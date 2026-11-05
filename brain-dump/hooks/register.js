// brain-dump: turns a long unsorted prompt into one Claude can act on

// Small and fast: this mod only sorts text, it doesn't do the work
const MODEL = 'claude-haiku-4-5-20251001'
// Below this many words a prompt is left alone
const WORDS = 90

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
let words = WORDS

// A dump is long and barely punctuated: speech written down, not a written request
function isDump(text) {
  const count = text.trim().split(/\s+/).length
  if (count < words) return false
  const stops = (text.match(/[.!?]/g) || []).length
  return stops <= count / 45
}

async function askModel($, system, prompt) {
  try {
    const answer = await $.model.complete({ model: MODEL, system, prompt, maxTokens: 700 })
    return answer.isAnswered ? answer.text.trim() : ''
  } catch (err) {
    return ''
  }
}

// Up to three things the dump leaves open, one per line
async function questionsFor($, text) {
  const said = await askModel(
    $,
    'You read a rough, unsorted request and name what is missing before work can start. ' +
      'Write at most three short questions, one per line, no numbering, no other text. ' +
      'Ask only what the text leaves genuinely unclear. Write them in the language of the text.',
    text,
  )
  return said === ''
    ? []
    : said
        .split('\n')
        .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
        .filter((line) => line.length > 3)
        .slice(0, 3)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await readSwitch($)
    $.clock.every(3000, () => readSwitch($))
    const saved = await $.store.get('settings')
    if (saved !== undefined && saved !== null) {
      if (typeof saved.isOn === 'boolean') isOn = saved.isOn
      if (typeof saved.words === 'number' && saved.words > 0) words = saved.words
    }
    try {
      await $.command.register({
        name: 'brain-dump',
        description: 'Turn the brain-dump catcher on or off, or set how long a prompt has to be',
        argumentHint: '[word count]',
      })
    } catch (err) {
      $.ui.log('brain-dump: /brain-dump not registered: ' + err.message)
    }
    return next(e)
  })

  on('command.run', { command: 'brain-dump' }, async ($, e) => {
    if (isOff) return { text: 'brain-dump is turned off in /mods.' }
    const count = Number(e.args)
    if (Number.isFinite(count) && count > 0) {
      words = count
      await $.store.set('settings', { isOn, words })
      return { text: 'Prompts of ' + words + ' words or more are now checked.' }
    }
    isOn = !isOn
    await $.store.set('settings', { isOn, words })
    return {
      text: isOn
        ? 'Brain-dump catcher on, for prompts of ' + words + ' words or more.'
        : 'Brain-dump catcher off.',
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (isOff || !isOn || !isDump(e.text)) return next(e)
    // Waiting inside a mods API call doesn't count against this hook's limit
    let answer = 'Send as it is'
    try {
      answer = await $.ui.ask('That is a long one. Sort it into a task first?', [
        'Sort it out',
        'Send as it is',
      ])
    } catch (err) {
      return next(e)
    }
    if (answer !== 'Sort it out') return next(e)

    const questions = await questionsFor($, e.text)
    const replies = []
    for (const question of questions) {
      try {
        const said = await $.ui.ask(question, ['Skip'])
        if (said !== 'Skip') replies.push(question + ' — ' + said)
      } catch (err) {
        break
      }
    }

    const sorted = await askModel(
      $,
      'You rewrite a rough request as a brief another person could work from. ' +
        'Use exactly these four headings and nothing else: The task, Why, Guardrails, Done when. ' +
        'Keep every fact and constraint from the original, invent none, and write in the language of the original. ' +
        'Be brief: this is a brief, not an essay.',
      replies.length === 0 ? e.text : e.text + '\n\nAnswers to what was unclear:\n' + replies.join('\n'),
    )
    if (sorted === '') {
      $.ui.toast('brain-dump could not reach the model, so the prompt went as you wrote it')
      return next(e)
    }
    return next({ ...e, text: sorted })
  })
}
