import { expect, test } from 'claude-code/testing'

const norm = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

test('/objave adds, lists due-today in order, marks done and deletes', async ($, on) => {
  const files = new Map<string, string>()
  const statuses: (string | undefined)[] = []
  on('command.register', () => ({ value: { command: 'objave' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 16, 9).getTime() }))
  on('fs.exists', (_: any, e: any) => ({ value: files.has(norm(e.path)) }))
  on('fs.read', (_: any, e: any) => ({ value: files.get(norm(e.path)) ?? '' }))
  on('fs.write', (_: any, e: any) => { files.set(norm(e.path), e.text); return { value: undefined } })
  on('ui.status', (_: any, e: any) => { statuses.push(e.text); return { value: undefined } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as any)

  expect((await $.command.run({ command: 'objave' } as any)).text).toMatch(/Nema zakazanih/)
  expect((await $.command.run({ command: 'objave', args: 'dodaj 2026-11-16 18:00 myspace x' } as any)).text).toMatch(/Nepoznata mreža/)

  await $.command.run({ command: 'objave', args: 'dodaj 2026-11-20 instagram Novi meni od petka' } as any)
  const r = await $.command.run({ command: 'objave', args: 'dodaj 2026-11-16 9:30 facebook Danas otvoreno do ponoći' } as any)
  expect(r.text).toMatch(/1\. 2026-11-16 09:30 · facebook \(DANAS\): Danas otvoreno[\s\S]*2\. 2026-11-20 · instagram: Novi meni/)
  expect(statuses.at(-1)).toBe('objave: 1 za danas')

  await $.command.run({ command: 'objave', args: 'objavljeno 1' } as any)
  expect(statuses.at(-1)).toBeUndefined()
  expect((await $.command.run({ command: 'objave' } as any)).text).not.toMatch(/facebook/)

  await $.command.run({ command: 'objave', args: 'obrisi 2' } as any)
  expect(JSON.parse(files.get('/w/objave.json')!)).toEqual([{ when: '2026-11-16 09:30', net: 'facebook', text: 'Danas otvoreno do ponoći', done: true }])
})
