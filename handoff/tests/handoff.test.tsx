import { expect, test } from 'claude-code/testing'

const CWD = '/work/drhoops'
const NOTE = 'Zadatak\nPopravi login.\nPutanje\nsrc/login.ts\nUrađeno\n-\nSljedeće\ntest\nOdluke\n-\nZamke\n-'

const BAND = {
  plugin: 'handoff',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, rows: 3 },
} as any

const norm = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

function engine(on: any, opts: { files: Map<string, string>; runs: string[][]; id: string; tokens: number[]; now: number[]; store?: [string, unknown][]; fork?: unknown }) {
  const store = new Map<string, unknown>(opts.store ?? [])
  on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('command.register', () => ({ value: { command: 'handoff' } }))
  on('clock.every', () => ({ deny: 'no timers in tests' }))
  on('clock.after', () => ({ deny: 'no timers in tests' }))
  // The engine's own drawing beneath the band: nothing of its own to show
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return <Text>-</Text> })
  on('clock.now', () => ({ value: opts.now[0] }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text, context: e.context }))
  on('session.id', () => ({ value: opts.id }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.usage', () => ({ value: { context: { tokens: opts.tokens[0], percent: 50 } } }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'popravi login' }] }))
  on('model.fork', () => ({ value: opts.fork ?? { isAnswered: true, text: NOTE, usage: {} } }))
  on('tool.call', () => ({ result: { tasks: [] } }))
  on('process.run', (_: any, e: any) => { opts.runs.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  on('fs.write', (_: any, e: any) => { opts.files.set(norm(e.path), e.text); return { value: undefined } })
  on('fs.read', (_: any, e: any) => {
    const text = opts.files.get(norm(e.path))
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
}

const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')

test('past 110k the band offers a new session; "Ne sad" waits for 30k more', async ($, on) => {
  const opts = { files: new Map<string, string>(), runs: [] as string[][], id: 's1', tokens: [90_000], now: [1_000_000] }
  engine(on, opts)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as any)

  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  let ui = await $.ui.mount(BAND)
  expect(await texts(ui)).not.toMatch(/Kontekst/)
  await ui.unmount()

  opts.tokens[0] = 115_000
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as any)
  ui = await $.ui.mount(BAND)
  expect(await texts(ui)).toMatch(/Kontekst 115k/)
  await ui.press({ key: 'later' })
  expect(await texts(ui)).not.toMatch(/Kontekst/)
  await ui.unmount()

  opts.tokens[0] = 130_000 // only 15k more: still quiet
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' } as any)
  ui = await $.ui.mount(BAND)
  expect(await texts(ui)).not.toMatch(/Kontekst/)
  await ui.unmount()

  opts.tokens[0] = 150_000
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't4', reason: 'answer' } as any)
  ui = await $.ui.mount(BAND)
  expect(await texts(ui)).toMatch(/Kontekst 150k/)

  // While Claude works the band steps aside
  const busy = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true } })
  expect(await texts(busy)).not.toMatch(/Kontekst/)
  await busy.unmount()

  await ui.press({ key: 'fresh' })
  expect(opts.files.get(`${CWD}/tasks/handoff.md`)).toMatch(/^Zadatak/)
  expect(JSON.parse(opts.files.get(`${CWD}/tasks/.handoff-pending`)!)).toEqual({ at: 1_000_000, from: 's1' })
  expect(opts.runs.at(-1)?.slice(0, 3)).toEqual(['cmd.exe', '/c', 'start'])
  expect(opts.runs.at(-1)?.slice(-3)).toEqual(['cmd', '/k', 'claude'])
  expect(opts.runs.at(-1)?.join(' ')).not.toContain(CWD) // no path on cmd's line
  expect(await texts(ui)).not.toMatch(/Kontekst/)
  await ui.unmount()

  // The session that wrote the marker never takes it back itself
  const own = await $.prompt.submit({ text: 'dalje' } as any)
  expect(own.context ?? []).toEqual([])
})

test('a new session gets the handoff on its first prompt, once; stale markers are ignored', async ($, on) => {
  const marker = { at: 2_000_000 - 3 * 60_000, from: 's1' }
  const opts = { files: new Map<string, string>(), runs: [] as string[][], id: 's2', tokens: [5_000], now: [2_000_000], store: [[`pending:${CWD}`, marker]] as [string, unknown][] }
  opts.files.set(`${CWD}/tasks/handoff.md`, NOTE + '\n')
  opts.files.set(`${CWD}/tasks/.handoff-pending`, JSON.stringify(marker))
  engine(on, opts)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as any)

  const first = await $.prompt.submit({ text: 'nastavi' } as any)
  expect(first.context?.at(-1)).toMatch(/prije 3 min[\s\S]*Zadatak\nPopravi login/)
  expect(JSON.parse(opts.files.get(`${CWD}/tasks/.handoff-pending`)!).isTaken).toBe(true)

  const second = await $.prompt.submit({ text: 'još' } as any)
  expect(second.context ?? []).toEqual([])
})

test('when the model does not answer, /handoff nova says why and opens nothing', async ($, on) => {
  const opts = { files: new Map<string, string>(), runs: [] as string[][], id: 's5', tokens: [5_000], now: [3_000_000], fork: { isAnswered: false, reason: 'api-error', status: 529 } }
  engine(on, opts)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as any)
  const r = await $.command.run({ command: 'handoff', args: 'nova' } as any)
  expect(r.text).toMatch(/nije upisan[\s\S]*api-error 529/)
  expect(opts.runs).toEqual([])
  expect(opts.files.get(`${CWD}/tasks/.handoff-pending`)).toBeUndefined()
})

test('a marker older than 15 minutes is left alone', async ($, on) => {
  const opts = { files: new Map<string, string>(), runs: [] as string[][], id: 's3', tokens: [5_000], now: [9_000_000] }
  opts.files.set(`${CWD}/tasks/handoff.md`, NOTE + '\n')
  opts.files.set(`${CWD}/tasks/.handoff-pending`, JSON.stringify({ at: 9_000_000 - 20 * 60_000, from: 's1' }))
  engine(on, opts)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as any)
  const first = await $.prompt.submit({ text: 'nastavi' } as any)
  expect(first.context ?? []).toEqual([])
})

for (const [name, marker, mine] of [
  ['a marker file this plugin never wrote (e.g. from a cloned repo)', { at: 2_000_000 - 60_000, from: 'attacker' }, undefined],
  ['a marker dated in the future', { at: 2_000_000 + 10 ** 12, from: 's1' }, { at: 2_000_000 + 10 ** 12, from: 's1' }],
] as const) {
  test(`${name} is ignored`, async ($, on) => {
    const opts = { files: new Map<string, string>(), runs: [] as string[][], id: 's4', tokens: [5_000], now: [2_000_000], store: (mine ? [[`pending:${CWD}`, mine]] : []) as [string, unknown][] }
    opts.files.set(`${CWD}/tasks/handoff.md`, NOTE + '\n')
    opts.files.set(`${CWD}/tasks/.handoff-pending`, JSON.stringify(marker))
    engine(on, opts)
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as any)
    const first = await $.prompt.submit({ text: 'nastavi' } as any)
    expect(first.context ?? []).toEqual([])
  })
}
