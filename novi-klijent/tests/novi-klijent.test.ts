import { expect, test } from 'claude-code/testing'

const norm = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
const REG = '/Users/LEGION/dimi-cli/apps.json'

test('nothing runs without "da"; with it, exactly one step runs', async ($, on) => {
  const runs: string[][] = []
  const files = new Map<string, string>([[REG, JSON.stringify({ schemaVersion: 1, apps: [{ id: 'drhoops' }] })]])
  on('command.register', () => ({ value: { command: 'novi-klijent' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('process.run', (_: any, e: any) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'ok', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_: any, e: any) => ({ value: files.get(norm(e.path)) ?? '' }))
  on('fs.write', (_: any, e: any) => { files.set(norm(e.path), e.text); return { value: undefined } })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as any)

  expect((await $.command.run({ command: 'novi-klijent', args: 'Bad Id' } as any)).text).toMatch(/Upotreba/)
  expect((await $.command.run({ command: 'novi-klijent', args: 'kafana' } as any)).text).toMatch(/gh repo create airdimitrije\/kafana --private/)

  const ask = await $.command.run({ command: 'novi-klijent', args: 'kafana vercel' } as any)
  expect(ask.text).toMatch(/Hobby[\s\S]*Potvrdi: \/novi-klijent kafana vercel da/)
  expect(runs).toEqual([])

  await $.command.run({ command: 'novi-klijent', args: 'kafana repo da' } as any)
  expect(runs).toEqual([['gh', 'repo', 'create', 'airdimitrije/kafana', '--private']])

  await $.command.run({ command: 'novi-klijent', args: 'kafana dimi' } as any)
  expect(JSON.parse(files.get(REG)!).apps.length).toBe(1)
  const done = await $.command.run({ command: 'novi-klijent', args: 'kafana dimi da' } as any)
  expect(done.text).toMatch(/Upisan kafana/)
  expect(JSON.parse(files.get(REG)!).apps.map((a: any) => a.id)).toEqual(['drhoops', 'kafana'])
  expect((await $.command.run({ command: 'novi-klijent', args: 'kafana dimi da' } as any)).text).toMatch(/već u registru/)
})
