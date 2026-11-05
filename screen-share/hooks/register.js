// screen-share: grey bars over the things you would rather not show on a call

// The sites whose text is covered. Claude Code draws them; this mod only
// changes the strings in what it was about to draw.
const SITES = ['UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup', 'CommandOutput']

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

let isOn = false
// Words to cover as well: a name, a company, a street. Kept on this machine.
let words = []

// What a bar looks like, never longer than the thing it covers
function bar(text) {
  return '█'.repeat(Math.min(text.length, 14))
}

function maskText(text) {
  let out = text
  // An address like name@example.com
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g, bar)
  // A key that looks like a secret
  out = out.replace(/\b(?:sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{12,}/g, bar)
  // An amount of money
  out = out.replace(/[$€£]\s?\d[\d.,]*/g, bar)
  out = out.replace(/\b\d[\d.,]*\s?(?:USD|EUR|RSD|dollars|euros)\b/gi, bar)
  // A phone number, written either way
  out = out.replace(/\+\d[\d\s()-]{7,}\d/g, bar)
  out = out.replace(/\b\d{3}[\s/-]\d{3}[\s-]\d{3,4}\b/g, bar)
  for (const word of words) {
    if (word === '') continue
    out = out.split(word).join(bar(word))
  }
  return out
}

// Props are plain data, so walk them and change only the strings. The shape
// stays exactly as it was, which is what the render site accepts.
function maskValue(value) {
  if (typeof value === 'string') return maskText(value)
  if (Array.isArray(value)) return value.map(maskValue)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = maskValue(value[key])
    return out
  }
  return value
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await readSwitch($)
    $.clock.every(3000, () => readSwitch($))
    const saved = await $.store.get('words')
    if (Array.isArray(saved)) words = saved
    try {
      await $.command.register({
        name: 'screen-share',
        description: 'Cover private things with grey bars, or stop covering them',
        argumentHint: '[word to add | -word to drop]',
      })
    } catch (err) {
      $.ui.log('screen-share: /screen-share not registered: ' + err.message)
    }
    return next(e)
  })

  on('command.run', { command: 'screen-share' }, async ($, e) => {
    if (isOff) return { text: 'screen-share is turned off in /mods.' }
    const arg = e.args.trim()
    if (arg !== '') {
      if (arg.startsWith('-')) {
        const drop = arg.slice(1)
        words = words.filter((word) => word !== drop)
      } else if (!words.includes(arg)) {
        words.push(arg)
      }
      await $.store.set('words', words)
      return { text: 'Covering ' + words.length + ' words of your own: ' + words.join(', ') }
    }
    isOn = !isOn
    $.ui.invalidate('ui.render')
    if (isOn) {
      $.ui.status('screen-share is on: addresses, numbers, amounts and ' + words.length + ' of your words are covered')
      return { text: 'Grey bars on. Type /screen-share again to take them off.' }
    }
    $.ui.status('')
    return { text: 'Grey bars off.' }
  })

  on('ui.render', { component: SITES }, async ($, e, next) => {
    if (isOff || !isOn) return next(e)
    return next({ ...e, props: maskValue(e.props) })
  })
}
