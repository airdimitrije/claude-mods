import type { Register } from 'claude-code'

// novi-klijent: sets up a new client app one step at a time — GitHub repo,
// Vercel project, Neon project, dimi-cli registry entry. Nothing runs on its
// own: `/novi-klijent <id> <step>` shows the exact command, and only
// `/novi-klijent <id> <step> da` runs it.

const OWNER = 'airdimitrije'
const REGISTRY = 'C:/Users/LEGION/dimi-cli/apps.json'
const ID = /^[a-z0-9][a-z0-9-]{1,38}$/

type Step = { key: string; what: string; argv: (id: string) => string[]; warn?: string }

export const STEPS: Step[] = [
  { key: 'repo', what: 'privatni GitHub repo', argv: id => ['gh', 'repo', 'create', `${OWNER}/${id}`, '--private'] },
  {
    key: 'vercel', what: 'Vercel projekat', argv: id => ['vercel', 'project', 'add', id],
    warn: 'Vercel Hobby uslovi zabranjuju komercijalne sajtove i mogu pauzirati cio nalog. Za klijenta koji plaća treba Pro.',
  },
  {
    key: 'neon', what: 'Neon projekat', argv: id => ['neonctl', 'projects', 'create', '--name', id],
    warn: 'Neon Free ima ograničen broj projekata; forma i prisustvo zato žive kao baze u DRHoops projektu.',
  },
  { key: 'dimi', what: 'unos u dimi-cli registar', argv: () => [] },
]

export function plan(id: string) {
  return [
    `Novi klijent: ${id}. Svaki korak ide posebno i tek uz "da":`,
    ...STEPS.map((s, i) => `${i + 1}. ${s.what}: /novi-klijent ${id} ${s.key}` +
      (s.key === 'dimi' ? ` (upisuje ${REGISTRY})` : `  →  ${s.argv(id).join(' ')}`)),
  ].join('\n')
}

export function entry(id: string) {
  return { id, name: id, path: `Desktop/01-Aktivno/${id}`, vercel: id, summary: '' }
}

async function addToRegistry($: any, id: string): Promise<string> {
  const raw = String(await $.fs.read(REGISTRY))
  const reg = JSON.parse(raw)
  if (!Array.isArray(reg.apps)) return `${REGISTRY} nema niz "apps", ne diram ga.`
  if (reg.apps.some((a: any) => a.id === id)) return `${id} je već u registru.`
  reg.apps.push(entry(id))
  await $.fs.write(REGISTRY, JSON.stringify(reg, null, 2) + '\n')
  return `Upisan ${id} u ${REGISTRY}. Dopuni name, summary, note i database ručno.`
}

async function run($: any, argv: string[]): Promise<string> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 120_000 })
    const out = (String(r.stdout) + String(r.stderr)).trim().slice(-1500)
    return r.exitCode === 0 ? `Urađeno: ${argv.join(' ')}\n${out}` : `Palo (kod ${r.exitCode}): ${argv.join(' ')}\n${out}`
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    return `Nije pokrenuto: ${argv.join(' ')}\n${msg}` +
      (argv[0] === 'neonctl' ? '\nneonctl nije instaliran? npm i -g neonctl, pa neonctl auth.' : '')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'novi-klijent', description: 'Postavi repo, Vercel, Neon i dimi-cli za novog klijenta, korak po korak uz potvrdu' })
    } catch (err) {
      $.ui.log('novi-klijent: not registered: ' + String((err as Error)?.message ?? err))
    }
    return next(e)
  })

  on('command.run', { command: 'novi-klijent' }, async ($, e) => {
    const [id = '', key, yes] = String(e.args ?? '').trim().split(/\s+/).map((w, i) => (i === 0 ? w : w.toLowerCase()))
    if (!ID.test(id)) return { text: 'Upotreba: /novi-klijent <id> [repo|vercel|neon|dimi] [da]. id: mala slova, cifre, crtice.' }
    if (key === undefined) return { text: plan(id) }
    const step = STEPS.find(s => s.key === key)
    if (!step) return { text: `Nepoznat korak "${key}".\n\n${plan(id)}` }
    if (yes !== 'da') {
      const action = step.key === 'dimi'
        ? `Upisuje u ${REGISTRY}:\n${JSON.stringify(entry(id), null, 2)}`
        : `Pokreće: ${step.argv(id).join(' ')}`
      return { text: `${step.what} za ${id}.\n${action}${step.warn ? `\nPažnja: ${step.warn}` : ''}\n\nPotvrdi: /novi-klijent ${id} ${step.key} da` }
    }
    if (step.key === 'dimi') {
      try {
        return { text: await addToRegistry($, id) }
      } catch (err) {
        return { text: `Registar nije upisan: ${String((err as Error)?.message ?? err)}` }
      }
    }
    return { text: await run($, step.argv(id)) }
  })
}
