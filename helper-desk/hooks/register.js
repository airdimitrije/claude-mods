// helper-desk: a progress band above the prompt, and a panel of the subagents at work

const PANE = 'helper-desk'
// Each helper gets the next colour in this list, so two rows never look alike
const COLORS = ['magenta', 'cyan', 'green', 'yellow', 'blue', 'red']

let isOff = false
let paneHidden = false

async function readSwitch($) {
  const root = $.plugin.root
  const cut = Math.max(root.lastIndexOf('\\'), root.lastIndexOf('/'))
  try {
    const parsed = JSON.parse(await $.fs.read(root.slice(0, cut) + '/.mods-state.json'))
    isOff = Array.isArray(parsed.disabled) && parsed.disabled.includes($.plugin.name)
    paneHidden = Array.isArray(parsed.hidePanes) && parsed.hidePanes.includes($.plugin.name)
  } catch (err) {
    isOff = false
    paneHidden = false
  }
}

// The task list, read from the task tools rather than guessed
let tasks = []
let refresh = null

async function readTasks($) {
  refresh = null
  try {
    const answer = await $.tool.call({ tool: 'TaskList' })
    tasks = answer.result.tasks
  } catch (err) {
    tasks = []
  }
  $.ui.invalidate('ui.render')
}

// One read a quarter second after a burst of task changes, instead of one per change
function readTasksSoon($) {
  if (refresh !== null) return
  refresh = $.clock.after(250, () => readTasks($))
}

// The helpers, oldest first: { agentId, label, kind, color, steps, isDone, ms, tokens, usd }
let helpers = []
// $.session.usage().cost.usd counts the whole session, so a helper's cost is
// how much that number moved while it was the one working
let lastUsd = 0
let paneOpened = false

function findHelper(agentId) {
  for (const helper of helpers) {
    if (helper.agentId === agentId) return helper
  }
  return null
}

async function chargeUsd($) {
  try {
    const usage = await $.session.usage()
    const now = usage.cost.usd
    const spent = lastUsd === 0 ? 0 : now - lastUsd
    lastUsd = now
    return spent > 0 ? spent : 0
  } catch (err) {
    return 0
  }
}

function bar(filled, width) {
  const full = Math.max(Math.min(Math.round(filled * width), width), 0)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

function money(usd) {
  if (usd === 0) return '—'
  if (usd < 0.01) return '<1¢'
  return '$' + usd.toFixed(2)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await readSwitch($)
    $.clock.every(3000, () => readSwitch($))
    await readTasks($)
    try {
      await $.command.register({ name: 'helpers', description: 'Open the subagent panel' })
    } catch (err) {
      $.ui.log('helper-desk: /helpers not registered: ' + err.message)
    }
    return next(e)
  })

  // The band fills as the task list changes, so watch the task tools
  on('tool.call', { tool: ['TaskCreate', 'TaskUpdate'] }, async ($, e, next) => {
    const result = await next(e)
    if (!isOff) readTasksSoon($)
    return result
  })

  // A spawn is the only place the agent id can be learned: next() hands it back
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (isOff || e.resume !== undefined) return result
    helpers.push({
      agentId: result.agentId,
      label: typeof e.description === 'string' && e.description !== '' ? e.description : e.subagentType,
      kind: e.subagentType,
      color: COLORS[helpers.length % COLORS.length],
      steps: 0,
      isDone: false,
      ms: 0,
      tokens: 0,
      usd: 0,
    })
    if (!paneHidden && !paneOpened) {
      paneOpened = true
      try {
        await $.ui.open({ id: PANE, title: 'Helpers' })
      } catch (err) {
        $.ui.log('helper-desk: panel not opened: ' + err.message)
      }
    }
    $.ui.invalidate('ui.render')
    return result
  })

  // A helper has no percentage to report, so count the steps it takes
  on('turn.step', async function* ($, e, next) {
    if (!isOff && e.agentId !== undefined) {
      const helper = findHelper(e.agentId)
      if (helper !== null) {
        helper.steps = e.index + 1
        $.ui.invalidate('ui.render')
      }
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (isOff) return next(e)
    const spent = await chargeUsd($)
    if (e.agentId === undefined) {
      readTasksSoon($)
      return next(e)
    }
    const helper = findHelper(e.agentId)
    if (helper !== null) {
      helper.isDone = true
      helper.ms = e.durationMs
      // A turn that failed carries no usage at all
      helper.tokens = e.usage === undefined ? 0 : e.usage.input_tokens + e.usage.output_tokens
      helper.usd = spent
    }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'helpers' }, async ($) => {
    if (isOff) return { text: 'helper-desk is turned off in /mods.' }
    paneOpened = true
    await $.ui.open({ id: PANE, title: 'Helpers', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    if (helpers.length === 0) {
      return Box({ children: [Text({ dimColor: true, children: ['No subagents in this chat yet.'] })] })
    }
    // Nothing reports how far a helper is, so the bars compare the helpers
    // with each other: the busiest one so far is a full bar
    let busiest = 1
    for (const helper of helpers) {
      if (helper.steps > busiest) busiest = helper.steps
    }
    const total = helpers.reduce((sum, helper) => sum + helper.usd, 0)

    const row = (helper) =>
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ color: helper.color, children: ['🦀'] }),
          Text({ color: helper.isDone ? undefined : helper.color, children: [bar(helper.steps / busiest, 10)] }),
          Text({ dimColor: true, children: [String(helper.steps).padStart(2) + ' steps'] }),
          Text({ dimColor: true, children: [money(helper.usd).padStart(5)] }),
          Text({
            dimColor: helper.isDone,
            children: [helper.label + (helper.isDone ? ' · ' + Math.round(helper.ms / 1000) + 's' : ' · working')],
          }),
        ],
      })

    return Box({
      flexDirection: 'column',
      children: [
        Text({
          dimColor: true,
          children: [
            helpers.length +
              ' helpers · ' +
              helpers.filter((helper) => !helper.isDone).length +
              ' working · ' +
              money(total) +
              ' between them',
          ],
        }),
        Text({ children: [' '] }),
        ...helpers.map(row),
      ],
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    if (isOff || tasks.length === 0) return theirs
    const { Box, Text } = $.ui.resolve(e)
    const done = tasks.filter((task) => task.status === 'completed').length
    const here = tasks.find((task) => task.status === 'in_progress') || tasks.find((task) => task.status === 'pending')
    const working = helpers.filter((helper) => !helper.isDone).length
    const parts = [
      Text({ color: 'magenta', children: [bar(done / tasks.length, 16)] }),
      Text({ children: [done + '/' + tasks.length] }),
      Text({ dimColor: true, children: [here === undefined ? 'all done' : '· ' + here.subject] }),
    ]
    if (working > 0) {
      parts.push(Text({ dimColor: true, children: ['· ' + working + (working === 1 ? ' helper' : ' helpers')] }))
    }
    return Box({
      flexDirection: 'column',
      children: [theirs, Box({ flexDirection: 'row', columnGap: 1, children: parts })],
    })
  })
}
