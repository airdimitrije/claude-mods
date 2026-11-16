import { expect, test } from 'claude-code/testing'
import { parseArgs } from '../hooks/register'

const norm = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

test('parseArgs keeps quoted values and the template name', () => {
  expect(parseArgs('ponuda klijent="Kafana Rakija" iznos=1200 napomena=\'bez PDV-a\'')).toEqual({
    name: 'ponuda', values: { klijent: 'Kafana Rakija', iznos: '1200', napomena: 'bez PDV-a' },
  })
})

test('/dokument lists, refuses missing fields, writes once and never overwrites', async ($, on) => {
  const files = new Map<string, string>([['/w/sabloni/ponuda.md', '# Ponuda za {{klijent}}\nIznos: {{iznos}} €\nDatum: {{datum}}\n']])
  on('command.register', () => ({ value: { command: 'dokument' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 16, 12).getTime() }))
  on('fs.exists', (_: any, e: any) => {
    const p = norm(e.path)
    return { value: files.has(p) || [...files.keys()].some(k => k.startsWith(p + '/')) }
  })
  on('fs.list', (_: any, e: any) => {
    const p = norm(e.path) + '/'
    return { value: [...files.keys()].filter(k => k.startsWith(p)).map(k => ({ name: k.slice(p.length), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_: any, e: any) => ({ value: files.get(norm(e.path)) ?? '' }))
  on('fs.write', (_: any, e: any) => { files.set(norm(e.path), e.text); return { value: undefined } })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as any)

  expect((await $.command.run({ command: 'dokument' } as any)).text).toMatch(/- ponuda: klijent, iznos, datum/)
  expect((await $.command.run({ command: 'dokument', args: 'ponuda klijent=Kafana' } as any)).text).toMatch(/Fale polja: iznos/)
  expect(files.size).toBe(1)

  const ok = await $.command.run({ command: 'dokument', args: 'ponuda klijent="Kafana Rakija" iznos=1200' } as any)
  expect(ok.text).toMatch(/Upisano: \/w\/ponuda-2026-11-16\.md/)
  expect(files.get('/w/ponuda-2026-11-16.md')).toBe('# Ponuda za Kafana Rakija\nIznos: 1200 €\nDatum: 16.11.2026.\n')

  const again = await $.command.run({ command: 'dokument', args: 'ponuda klijent=X iznos=1' } as any)
  expect(again.text).toMatch(/već postoji/)
  expect(files.get('/w/ponuda-2026-11-16.md')).toMatch(/Kafana Rakija/)
})
