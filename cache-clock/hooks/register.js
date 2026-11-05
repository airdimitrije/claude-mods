// cache-clock: how long until this chat's prompt cache goes cold, and a way to keep it warm

// Keep-warm gives up after two hours of nobody typing
const WARM_LIMIT_MS = 2 * 60 * 60 * 1000
// Touch the cache a minute before it would go cold
const LEAD_MS = 60 * 1000

let isOff = false
let bandHidden = false

async function readSwitch($) {
  const root = $.plugin.root
  const cut = Math.max(root.lastIndexOf('\\'), root.lastIndexOf('/'))
  try {
    const parsed = JSON.parse(await $.fs.read(root.slice(0, cut) + '/.mods-state.json'))
    isOff = Array.isArray(parsed.disabled) && parsed.disabled.includes($.plugin.name)
    bandHidden = Array.isArray(parsed.hidePanes) && parsed.hidePanes.includes($.plugin.name)
  } catch (err) {
    isOff = false
    bandHidden = false
  }
}

// How long a cache entry lives. One hour on a Claude subscription, five
// minutes on an API key, and the API never tells us which, so it is a setting.
let ttlMs = 60 * 60 * 1000
// When the cache was last written or read: the last reply, or the last touch
let anchor = 0
// The cache numbers of the last reply, so the band can show what was reused
let lastRead = 0
let lastWritten = 0
// Keep-warm: when it was armed, its timer, and what happened last
let armedAt = 0
let timer = null
let touches = 0
let note = ''

function clear() {
  if (timer !== null) timer.cancel()
  timer = null
}

async function touch($) {
  clear()
  const now = await $.clock.now()
  if (armedAt === 0 || now - armedAt > WARM_LIMIT_MS) {
    armedAt = 0
    note = 'keep-warm stopped after two hours'
    $.ui.invalidate('ui.render')
    return
  }
  try {
    // A fork replays this conversation, so the API reads it from the cache
    // and the entry's life starts again. The reply is one word, so the only
    // real cost is the cache read.
    const answer = await $.model.fork({ prompt: 'Reply with one word: ok. Say nothing else.' })
    if (answer.isAnswered) {
      touches += 1
      anchor = await $.clock.now()
      note = 'kept warm ' + touches + (touches === 1 ? ' time' : ' times')
    } else {
      armedAt = 0
      note = 'keep-warm stopped: ' + answer.reason
    }
  } catch (err) {
    armedAt = 0
    note = 'keep-warm stopped: ' + err.message
  }
  if (armedAt !== 0) arm($)
  $.ui.invalidate('ui.render')
}

function arm($) {
  clear()
  const wait = Math.max(ttlMs - LEAD_MS, 10_000)
  timer = $.clock.after(wait, () => touch($))
}

function clock(ms) {
  const total = Math.max(Math.round(ms / 1000), 0)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes + ':' + String(seconds).padStart(2, '0')
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await readSwitch($)
    $.clock.every(3000, () => readSwitch($))
    const saved = await $.store.get('ttlMinutes')
    if (typeof saved === 'number' && saved > 0) ttlMs = saved * 60 * 1000
    $.clock.every(1000, () => $.ui.invalidate('ui.render'))
    try {
      await $.command.register({
        name: 'keep-warm',
        description: 'Keep this chat’s prompt cache warm, or stop keeping it warm',
        argumentHint: '[ttl minutes]',
      })
    } catch (err) {
      $.ui.log('cache-clock: /keep-warm not registered: ' + err.message)
    }
    return next(e)
  })

  // Every reply writes or reads the cache, so it restarts the entry's life
  on('turn.complete', async ($, e, next) => {
    if (isOff || e.agentId !== undefined) return next(e)
    anchor = await $.clock.now()
    // A turn that failed carries no usage at all
    if (e.usage !== undefined) {
      lastRead = e.usage.cache_read_input_tokens
      lastWritten = e.usage.cache_creation_input_tokens
    }
    if (armedAt !== 0) arm($)
    return next(e)
  })

  // Typing is the cheapest way to keep a cache warm, so stop paying for it
  on('prompt.submit', async ($, e, next) => {
    if (armedAt !== 0) {
      armedAt = 0
      clear()
      note = 'keep-warm off: you are here'
    }
    return next(e)
  })

  on('command.run', { command: 'keep-warm' }, async ($, e) => {
    if (isOff) return { text: 'cache-clock is turned off in /mods.' }
    const minutes = Number(e.args)
    if (Number.isFinite(minutes) && minutes > 0) {
      ttlMs = minutes * 60 * 1000
      await $.store.set('ttlMinutes', minutes)
    }
    if (armedAt === 0) {
      armedAt = await $.clock.now()
      touches = 0
      note = ''
      arm($)
      return {
        text:
          'Keep-warm on. The cache is touched a minute before it would go cold, ' +
          'the TTL is ' + Math.round(ttlMs / 60000) + ' minutes, and it stops on your next message or after two hours.',
      }
    }
    armedAt = 0
    clear()
    note = ''
    return { text: 'Keep-warm off after ' + touches + ' touches.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    if (isOff || bandHidden || anchor === 0) return theirs
    const { Box, Text, Button } = $.ui.resolve(e)
    const left = ttlMs - ((await $.clock.now()) - anchor)
    const isCold = left <= 0
    const parts = [
      Text({
        color: isCold ? 'red' : left < 5 * 60 * 1000 ? 'yellow' : 'green',
        children: [isCold ? 'cache cold' : 'cache warm ' + clock(left)],
      }),
      Text({ dimColor: true, children: ['· reused ' + lastRead.toLocaleString() + ' tokens, wrote ' + lastWritten.toLocaleString()] }),
      Button({
        key: 'warm',
        label: armedAt === 0 ? 'keep warm' : 'stop keeping warm',
        plain: true,
        onPress: async () => {
          if (armedAt === 0) {
            armedAt = await $.clock.now()
            touches = 0
            note = ''
            arm($)
          } else {
            armedAt = 0
            clear()
            note = ''
          }
          $.ui.invalidate('ui.render')
        },
      }),
    ]
    if (note !== '') parts.push(Text({ dimColor: true, children: ['· ' + note] }))
    return Box({
      flexDirection: 'column',
      children: [theirs, Box({ flexDirection: 'row', columnGap: 1, children: parts })],
    })
  })
}
