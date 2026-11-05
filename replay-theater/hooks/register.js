// replay-theater: /replay steps through the file changes Claude made in this chat

const PANE = 'replay-theater'
// A snapshot bigger than this is skipped: $.fs has a 4 MiB limit
const MAX_BYTES = 3_500_000

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

// Where snapshots live, and the changes recorded so far
let dir = ''
// { path, tool, at, before (file name or null), added, removed }
let changes = []
let cursor = 0

function parentDir(root) {
  const cut = Math.max(root.lastIndexOf('\\'), root.lastIndexOf('/'))
  return root.slice(0, cut)
}

async function readOrNull($, path) {
  try {
    const text = await $.fs.read(path)
    return text.length > MAX_BYTES ? null : text
  } catch (err) {
    return null
  }
}

// Line counts of what the change took out and put in, after trimming the
// shared start and end, so a one-line edit reads as one line
function countDiff(before, after) {
  const a = before === null ? [] : before.split('\n')
  const b = after === null ? [] : after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1
  }
  return { removed: a.length - head - tail, added: b.length - head - tail, at: head + 1 }
}

async function saveIndex($) {
  try {
    await $.fs.write(dir + '/index.json', JSON.stringify(changes))
  } catch (err) {
    $.ui.log('replay-theater: cannot write the index: ' + err.message)
  }
}

async function loadIndex($) {
  try {
    const parsed = JSON.parse(await $.fs.read(dir + '/index.json'))
    if (Array.isArray(parsed)) {
      changes = parsed
      cursor = Math.max(changes.length - 1, 0)
    }
  } catch (err) {
    changes = []
  }
}

async function restore($, change) {
  if (change.before === null) {
    return 'That change created the file, so there is no earlier version to put back.'
  }
  const text = await readOrNull($, dir + '/' + change.before)
  if (text === null) return 'The snapshot is gone.'
  await $.fs.write(change.path, text)
  return 'Put back the version from before change ' + (changes.indexOf(change) + 1) + '.'
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await readSwitch($)
    $.clock.every(3000, () => readSwitch($))
    const id = await $.session.id()
    dir = parentDir($.plugin.root) + '/.replay/' + id
    await loadIndex($)
    try {
      await $.command.register({ name: 'replay', description: 'Step through this chat’s file changes' })
    } catch (err) {
      $.ui.log('replay-theater: /replay not registered: ' + err.message)
    }
    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    if (isOff || typeof e.file_path !== 'string') return next(e)
    const before = await readOrNull($, e.file_path)
    const result = await next(e)
    const after = await readOrNull($, e.file_path)
    if (before === after) return result
    const index = changes.length + 1
    let snapshot = null
    if (before !== null) {
      snapshot = index + '.snap'
      try {
        await $.fs.write(dir + '/' + snapshot, before)
      } catch (err) {
        snapshot = null
      }
    }
    const counted = countDiff(before, after)
    changes.push({
      path: e.file_path,
      tool: e.tool,
      at: counted.at,
      added: counted.added,
      removed: counted.removed,
      before: snapshot,
    })
    cursor = changes.length - 1
    await saveIndex($)
    return result
  })

  on('command.run', { command: 'replay' }, async ($) => {
    if (isOff) return { text: 'replay-theater is turned off in /mods.' }
    if (changes.length === 0) return { text: 'No file changes recorded in this chat yet.' }
    await $.ui.open({ id: PANE, title: 'Replay', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    const here = changes[cursor]

    const step = (by) => {
      cursor = Math.min(Math.max(cursor + by, 0), changes.length - 1)
      redraw()
    }

    const row = (change, index) =>
      Text({
        bold: index === cursor,
        dimColor: index !== cursor,
        children: [
          (index === cursor ? '> ' : '  ') +
            String(index + 1).padStart(3) +
            '  ' +
            change.tool.padEnd(12) +
            '  -' +
            change.removed +
            ' +' +
            change.added +
            '  ' +
            change.path,
        ],
      })

    return Box({
      flexDirection: 'column',
      children: [
        Text({ dimColor: true, children: [changes.length + ' changes · snapshots in ' + dir] }),
        Text({ children: [' '] }),
        ...changes.map(row),
        Text({ children: [' '] }),
        Text({
          children: [
            'Change ' + (cursor + 1) + ' of ' + changes.length + ': ' + here.tool + ' at line ' + here.at +
              ', took out ' + here.removed + ' and put in ' + here.added,
          ],
        }),
        Text({ children: [' '] }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({ key: 'back', label: '< earlier', hotkey: 'k', onPress: () => step(-1) }),
            Button({ key: 'fwd', label: 'later >', hotkey: 'j', onPress: () => step(1) }),
            Button({
              key: 'restore',
              label: 'Put this version back',
              hotkey: 'p',
              onPress: async () => {
                const said = await restore($, changes[cursor])
                $.ui.toast(said)
                redraw()
              },
            }),
          ],
        }),
      ],
    })
  })
}
