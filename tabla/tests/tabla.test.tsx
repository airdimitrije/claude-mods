import { expect, test } from 'claude-code/testing'

const HOME = '/home/dimi'
const DIR = `${HOME}/.claude/session-board`

const PANE = {
  plugin: 'tabla',
  component: 'Pane',
  requestId: 'tabla',
  props: {
    title: 'Tabla sesija',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// The engine beneath the mod: an in-memory folder, a session id, a home dir,
// and a recorder for phone pushes.
// The engine hands fs hooks an absolute host path (C:\home\... on Windows): fold it back.
const norm = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

function engine(on: any, files: Map<string, string>, pushes: string[]) {
  const store = new Map<string, unknown>()
  on('store.get', (_: any, e: any) => ({ value: store.get(e.key ?? e.name) }))
  on('store.set', (_: any, e: any) => { store.set(e.key ?? e.name, e.value); return { value: undefined } })
  on('command.register', () => ({ value: { command: 'tabla' } }))
  // Timers never fire in these tests: the board is driven by the events themselves.
  on('clock.every', () => ({ deny: 'no timers in tests' }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('classic.Notification', () => ({}))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'me-1' }))
  on('session.cwd', () => ({ value: '/work/drhoops' }))
  on('session.usage', () => ({ value: { context: { tokens: 42_000, percent: 26 } } }))
  on('process.run', (_: any, e: any) => ({
    value: { exitCode: 0, stdout: e.argv[1] === '-p' ? `${HOME}\n` : '', stderr: '' },
  }))
  on('fs.write', (_: any, e: any) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', (_: any, e: any) => {
    const d = norm(e.path)
    return {
      value: [...files.keys()]
        .filter(p => p.startsWith(`${d}/`))
        .map(p => ({ name: p.slice(d.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
    }
  })
  on('fs.read', (_: any, e: any) => ({ value: files.get(norm(e.path)) ?? '' }))
  on('tool.call', (_: any, e: any) => {
    if (e.tool === 'PushNotification') pushes.push(e.message)
    return { result: {} }
  })
}

test('the board shows this session and another one, most urgent first', async ($, on) => {
  const files = new Map<string, string>()
  const pushes: string[] = []
  engine(on, files, pushes)
  const now = Date.now()
  files.set(
    `${DIR}/other.json`,
    JSON.stringify({ id: 'other', project: 'forma', cwd: '/work/forma', status: 'traži dozvolu', title: 'migracija', tokens: 90_000, percent: 56, changedAt: now, aliveAt: now }),
  )
  files.set(
    `${DIR}/dead.json`,
    JSON.stringify({ id: 'dead', project: 'stari', cwd: '/x', status: 'radi', title: '', tokens: 0, percent: 0, changedAt: 0, aliveAt: 0 }),
  )

  await $.session.start({ cwd: '/work/drhoops', surface: 'terminal', isInteractive: true })
  expect(JSON.parse(files.get(`${DIR}/me-1.json`)!).project).toBe('drhoops')

  await $.prompt.submit({ text: 'popravi login formu' } as any)
  expect(JSON.parse(files.get(`${DIR}/me-1.json`)!).status).toBe('radi')

  await $.command.run({ command: 'tabla', args: '' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(texts).toMatch(/forma[\s\S]*traži dozvolu[\s\S]*drhoops \(ova\)[\s\S]*radi/)
    expect(texts).toMatch(/popravi login formu/)
    expect(texts).not.toMatch(/stari/) // no heartbeat for minutes: hidden
    await ui.unmount()
  }
})

test('a long turn and a permission prompt each send one push', async ($, on) => {
  const files = new Map<string, string>()
  const pushes: string[] = []
  engine(on, files, pushes)

  await $.session.start({ cwd: '/work/drhoops', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'kratko', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  expect(pushes.length).toBe(0)

  await $.turn.complete({ answer: 'Build prošao, testovi zeleni.', durationMs: 180_000, isAborted: false, turnId: 't2', reason: 'answer' } as any)
  expect(pushes.length).toBe(1)
  expect(pushes[0]).toMatch(/^drhoops: gotovo \(3m\) — Build prošao/)
  expect(JSON.parse(files.get(`${DIR}/me-1.json`)!).status).toBe('čeka tebe')

  // A subagent's turn is not the person's business.
  await $.turn.complete({ answer: 'x', durationMs: 999_000, isAborted: false, turnId: 't3', reason: 'answer', agentId: 'a1' } as any)
  expect(pushes.length).toBe(1)

  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  expect(pushes.length).toBe(2)
  expect(pushes[1]).toMatch(/traži dozvolu/)
  expect(JSON.parse(files.get(`${DIR}/me-1.json`)!).status).toBe('traži dozvolu')

  await $.command.run({ command: 'tabla', args: 'push off' } as any)
  await $.classic.Notification({ message: 'again', notification_type: 'permission_prompt' })
  expect(pushes.length).toBe(2)
})

test('session end marks the heartbeat closed', async ($, on) => {
  const files = new Map<string, string>()
  engine(on, files, [])
  await $.session.start({ cwd: '/work/drhoops', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'exit', sessionId: 'me-1' } as any)
  expect(JSON.parse(files.get(`${DIR}/me-1.json`)!).isClosed).toBe(true)
})
