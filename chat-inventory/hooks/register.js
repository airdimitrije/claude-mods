// chat-inventory: /inventory shows what this chat has actually used

const PANE = 'chat-inventory'

// Switchboard state, read from the file switchboard writes next to the mods
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

// What the pane shows
let goal = ''
const tools = new Map()
const connectors = new Map()
const skills = new Map()
const filesRead = new Set()
const filesWritten = new Set()
const filesEdited = new Set()
let tasks = []

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1)
}

async function refreshTasks($) {
  try {
    const answer = await $.tool.call({ tool: 'TaskList' })
    tasks = answer.result.tasks
  } catch (err) {
    tasks = []
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await readSwitch($)
    $.clock.every(3000, () => readSwitch($))
    try {
      await $.command.register({ name: 'inventory', description: 'Open the "In this chat" panel' })
    } catch (err) {
      $.ui.log('chat-inventory: /inventory not registered: ' + err.message)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isOff && goal === '') goal = e.text.trim().slice(0, 300)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (isOff) return next(e)
    const name = e.tool
    bump(tools, name)
    if (name.startsWith('mcp__')) {
      const parts = name.split('__')
      bump(connectors, parts[1] || name)
    }
    if (name === 'Skill' && typeof e.skill === 'string') bump(skills, e.skill)
    if (typeof e.file_path === 'string') {
      if (name === 'Read') filesRead.add(e.file_path)
      else if (name === 'Write') filesWritten.add(e.file_path)
      else filesEdited.add(e.file_path)
    }
    return next(e)
  })

  on('command.run', { command: 'inventory' }, async ($) => {
    if (isOff) return { text: 'chat-inventory is turned off in /mods.' }
    await refreshTasks($)
    await $.ui.open({ id: PANE, title: 'In this chat', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    const mark = { completed: '[x]', in_progress: '[>]' }
    const counted = (map) =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => Text({ children: ['  ' + name + '  ' + count] }))

    const section = (title, rows) =>
      rows.length === 0
        ? []
        : [Text({ bold: true, children: [title] }), ...rows, Text({ children: [' '] })]

    const fileRows = (set, limit) => {
      const all = [...set]
      const shown = all.slice(0, limit).map((path) => Text({ dimColor: true, children: ['  ' + path] }))
      if (all.length > limit) {
        shown.push(Text({ dimColor: true, children: ['  +' + (all.length - limit) + ' more'] }))
      }
      return shown
    }

    return Box({
      flexDirection: 'column',
      children: [
        Text({ bold: true, children: ['Goal'] }),
        Text({ children: ['  ' + (goal || '(no prompt yet)')] }),
        Text({ children: [' '] }),
        ...section(
          'Tasks',
          tasks.map((task) =>
            Text({
              dimColor: task.status === 'completed',
              children: ['  ' + (mark[task.status] || '[ ]') + ' ' + task.subject],
            }),
          ),
        ),
        ...section('Connectors', counted(connectors)),
        ...section('Skills', counted(skills)),
        ...section('Tools', counted(tools)),
        ...section('Files read', fileRows(filesRead, 8)),
        ...section('Files changed', fileRows(filesEdited, 8)),
        ...section('Files created', fileRows(filesWritten, 8)),
        Button({
          key: 'refresh',
          label: 'Refresh tasks',
          hotkey: 'r',
          onPress: async () => {
            await refreshTasks($)
            $.ui.invalidate('ui.render')
          },
        }),
      ],
    })
  })
}
