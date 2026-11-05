// switchboard: /mods lists every mod in the plugin directory and turns it off

const PANE = 'switchboard'

// The folder that holds every mod, one level above this plugin's own folder
function parentDir(root) {
  const cut = Math.max(root.lastIndexOf('\\'), root.lastIndexOf('/'))
  return root.slice(0, cut)
}

// The file every mod of ours reads to learn whether it is off
function stateFile(root) {
  return parentDir(root) + '/.mods-state.json'
}

// What the pane shows: the mods found on disk and which of them are off
let mods = []
let state = { disabled: [], hidePanes: [] }
let scanError = ''

async function loadState($) {
  try {
    const parsed = JSON.parse(await $.fs.read(stateFile($.plugin.root)))
    state = {
      disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [],
      hidePanes: Array.isArray(parsed.hidePanes) ? parsed.hidePanes : [],
    }
  } catch (err) {
    state = { disabled: [], hidePanes: [] }
  }
}

async function saveState($) {
  await $.fs.write(stateFile($.plugin.root), JSON.stringify(state, null, 2))
}

// A folder is a mod when it has a plugin manifest and a hooks module
async function scanMods($) {
  const dir = parentDir($.plugin.root)
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch (err) {
    scanError = 'cannot list ' + dir + ': ' + err.message
    return
  }
  const found = []
  for (const entry of entries) {
    let manifest
    try {
      manifest = JSON.parse(await $.fs.read(dir + '/' + entry.name + '/.claude-plugin/plugin.json'))
    } catch (err) {
      continue
    }
    let hasModule = false
    try {
      const hooks = JSON.parse(await $.fs.read(dir + '/' + entry.name + '/hooks/hooks.json'))
      hasModule = Array.isArray(hooks.modules) && hooks.modules.length > 0
    } catch (err) {
      hasModule = false
    }
    found.push({
      name: typeof manifest.name === 'string' ? manifest.name : entry.name,
      description: typeof manifest.description === 'string' ? manifest.description : '',
      hasModule,
    })
  }
  found.sort((a, b) => (a.name < b.name ? -1 : 1))
  mods = found
  scanError = ''
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadState($)
    await scanMods($)
    try {
      await $.command.register({ name: 'mods', description: 'Open the mods switchboard' })
    } catch (err) {
      $.ui.log('switchboard: /mods not registered: ' + err.message)
    }
    return next(e)
  })

  on('command.run', { command: 'mods' }, async ($) => {
    await loadState($)
    await scanMods($)
    await $.ui.open({ id: PANE, title: 'Mods', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')

    const toggle = (list, name) => {
      const at = list.indexOf(name)
      if (at === -1) list.push(name)
      else list.splice(at, 1)
    }

    const row = (mod) => {
      const isSelf = mod.name === $.plugin.name
      const isOff = state.disabled.includes(mod.name)
      const isHidden = state.hidePanes.includes(mod.name)
      const children = [
        Button({
          key: 'off-' + mod.name,
          label: isOff ? '[ ]' : '[x]',
          plain: true,
          dimColor: isSelf,
          onPress: async () => {
            if (isSelf) return
            toggle(state.disabled, mod.name)
            redraw()
            await saveState($)
          },
        }),
        Text({ children: [' ' + mod.name + (isSelf ? ' (this one)' : '') + ' '] }),
      ]
      if (!isOff && !isSelf) {
        children.push(
          Button({
            key: 'pane-' + mod.name,
            label: isHidden ? 'panes off' : 'panes on',
            plain: true,
            dimColor: true,
            onPress: async () => {
              toggle(state.hidePanes, mod.name)
              redraw()
              await saveState($)
            },
          }),
        )
      }
      if (!mod.hasModule) children.push(Text({ dimColor: true, children: [' (no hooks module)'] }))
      return Box({ flexDirection: 'row', columnGap: 1, children })
    }

    const header = scanError
      ? Text({ children: [scanError] })
      : Text({
          dimColor: true,
          children: [
            mods.length + ' mods in ' + parentDir($.plugin.root) + ' · ' + state.disabled.length + ' off',
          ],
        })

    return Box({
      flexDirection: 'column',
      children: [
        header,
        Text({ children: [' '] }),
        ...mods.map(row),
        Text({ children: [' '] }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({
              key: 'rescan',
              label: 'Rescan',
              hotkey: 'r',
              onPress: async () => {
                await scanMods($)
                redraw()
              },
            }),
            Text({ dimColor: true, children: ['a mod turned off here goes quiet within a few seconds'] }),
          ],
        }),
      ],
    })
  })
}
