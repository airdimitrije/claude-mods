let toolCalls = 0
let surface = 'unknown'

export function register(on) {
  on('session.start', async ($, e, next) => {
    surface = await $.session.surfaces()
    try {
      await $.command.register({
        name: 'probe',
        description: 'Report that the mods infrastructure is loaded on this surface',
      })
    } catch (err) {
      $.ui.log('probe-mod: /probe not registered: ' + err.message)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    toolCalls += 1
    return next(e)
  })

  on('command.run', { command: 'probe' }, async ($) => {
    const version = await $.session.version()
    return {
      text:
        'probe-mod is live.\n' +
        'surface: ' + JSON.stringify(surface) + '\n' +
        'claude code: ' + JSON.stringify(version) + '\n' +
        'plugin root: ' + $.plugin.root + '\n' +
        'tool calls seen: ' + toolCalls,
    }
  })
}
