import type { Register } from 'claude-code'

// dokument: fills a template from <cwd>/sabloni/ — {{polje}} placeholders —
// into a new file next to it. `/dokument` lists templates and their fields;
// `/dokument ponuda klijent="Kafana Rakija" iznos=1200` writes
// ponuda-2026-11-16.md. Never overwrites, never writes with a field missing.
// {{datum}} defaults to today. For .docx, ask Claude (document-skills).

const DIR = 'sabloni'
const FIELD = /\{\{\s*([\p{L}\d_-]+)\s*\}\}/gu

export function fields(text: string): string[] {
  return [...new Set([...text.matchAll(FIELD)].map(m => m[1]!))]
}

export function fill(text: string, values: Record<string, string>): string {
  return text.replace(FIELD, (all, k: string) => values[k] ?? all)
}

// k=v k2="a b" k3='c d'
export function parseArgs(s: string): { name: string; values: Record<string, string> } {
  const values: Record<string, string> = {}
  const name = s.trim().split(/\s+/)[0] ?? ''
  for (const m of s.matchAll(/([\p{L}\d_-]+)=(?:"([^"]*)"|'([^']*)'|(\S+))/gu)) values[m[1]!] = m[2] ?? m[3] ?? m[4] ?? ''
  return { name: name.includes('=') ? '' : name, values }
}

const today = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return { iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, me: `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}.` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'dokument', description: 'Popuni šablon iz sabloni/ (ponuda, izvještaj) u novi fajl' })
    } catch (err) {
      $.ui.log('dokument: not registered: ' + String((err as Error)?.message ?? err))
    }
    return next(e)
  })

  on('command.run', { command: 'dokument' }, async ($, e) => {
    const cwd = String(await $.session.cwd()).replace(/\\/g, '/')
    const dir = `${cwd}/${DIR}`
    try {
      if (!(await $.fs.exists(dir))) return { text: `Nema foldera ${dir}. Napravi ga i stavi šablone (.md) sa poljima kao {{klijent}}.` }
      const templates = (await $.fs.list(dir)).filter(f => f.kind === 'file').map(f => f.name)
      const { name, values } = parseArgs(String(e.args ?? ''))

      if (!name) {
        if (!templates.length) return { text: `${dir} je prazan.` }
        const rows = await Promise.all(templates.map(async t => `- ${t.replace(/\.[^.]+$/, '')}: ${fields(String(await $.fs.read(`${dir}/${t}`))).join(', ') || '(bez polja)'}`))
        return { text: `Šabloni u ${dir}:\n${rows.join('\n')}\n\nUpotreba: /dokument <šablon> polje=vrijednost polje2="sa razmacima"` }
      }

      const file = templates.find(t => t === name || t.replace(/\.[^.]+$/, '') === name)
      if (!file) return { text: `Nema šablona "${name}". Ima: ${templates.join(', ') || 'ništa'}.` }
      const text = String(await $.fs.read(`${dir}/${file}`))
      const d = today(await $.clock.now())
      const all: Record<string, string> = { datum: d.me, ...values }
      const missing = fields(text).filter(f => all[f] === undefined)
      if (missing.length) return { text: `Fale polja: ${missing.join(', ')}. Ništa nije upisano.` }

      const ext = file.includes('.') ? file.slice(file.lastIndexOf('.')) : '.md'
      const out = `${cwd}/${file.slice(0, file.length - ext.length)}-${d.iso}${ext}`
      if (await $.fs.exists(out)) return { text: `${out} već postoji, ne prepisujem. Preimenuj ga ili obriši pa ponovi.` }
      await $.fs.write(out, fill(text, all))
      const unused = Object.keys(values).filter(k => !fields(text).includes(k))
      return { text: `Upisano: ${out}` + (unused.length ? `\nNeiskorišćena polja: ${unused.join(', ')}` : '') + '\nZa .docx ili PDF traži od Claude-a da ga pretvori (document-skills).' }
    } catch (err) {
      return { text: `dokument: ${String((err as Error)?.message ?? err)}` }
    }
  })
}
