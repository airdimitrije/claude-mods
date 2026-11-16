import type { Register } from 'claude-code'

// objave: a posting schedule for social media in <cwd>/objave.json. Claude or
// the person drafts the text; this keeps when and where it goes. Nothing is
// ever posted from here. The status line shows what is due today.
//   /objave                                   upcoming, numbered
//   /objave dodaj 2026-11-20 10:00 instagram Tekst objave...
//   /objave objavljeno <n>    /objave obrisi <n>

const FILE = 'objave.json'
const NETS = ['instagram', 'facebook', 'tiktok', 'linkedin', 'x', 'youtube']

export type Post = { when: string; net: string; text: string; done?: boolean }

const pad = (n: number) => String(n).padStart(2, '0')
const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

async function load($: any, path: string): Promise<Post[]> {
  if (!(await $.fs.exists(path))) return []
  const data = JSON.parse(String(await $.fs.read(path)))
  if (!Array.isArray(data)) throw new Error(`${path} nije niz objava, ne diram ga.`)
  return data
}

const save = ($: any, path: string, posts: Post[]) =>
  $.fs.write(path, JSON.stringify([...posts].sort((a, b) => a.when.localeCompare(b.when)), null, 2) + '\n')

export function list(posts: Post[], today: string): string {
  const open = posts.map((p, i) => ({ p, n: i + 1 })).filter(x => !x.p.done)
  if (!open.length) return 'Nema zakazanih objava. Dodaj: /objave dodaj 2026-11-20 10:00 instagram Tekst...'
  return open.map(({ p, n }) => {
    const tag = p.when.slice(0, 10) < today ? ' (KASNI)' : p.when.startsWith(today) ? ' (DANAS)' : ''
    return `${n}. ${p.when} · ${p.net}${tag}: ${p.text.length > 80 ? p.text.slice(0, 80) + '…' : p.text}`
  }).join('\n')
}

async function status($: any, path: string) {
  try {
    const today = day(await $.clock.now())
    const due = (await load($, path)).filter(p => !p.done && p.when.slice(0, 10) <= today).length
    await $.ui.status(due ? `objave: ${due} za danas` : undefined)
  } catch {
    await $.ui.status(undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'objave', description: 'Raspored objava za društvene mreže (objave.json); ništa ne objavljuje samo' })
    } catch (err) {
      $.ui.log('objave: not registered: ' + String((err as Error)?.message ?? err))
    }
    const r = await next(e)
    await status($, `${String(e.cwd).replace(/\\/g, '/')}/${FILE}`)
    return r
  })

  on('command.run', { command: 'objave' }, async ($, e) => {
    const path = `${String(await $.session.cwd()).replace(/\\/g, '/')}/${FILE}`
    const args = String(e.args ?? '').trim()
    const [verb = '', ...rest] = args.split(/\s+/)
    try {
      const posts = await load($, path)
      const today = day(await $.clock.now())
      let text: string

      if (!verb) text = list(posts, today)
      else if (verb === 'dodaj') {
        const m = args.match(/^dodaj\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\s+(\S+)\s+([\s\S]+)$/)
        if (!m) return { text: 'Upotreba: /objave dodaj YYYY-MM-DD [HH:MM] <mreža> <tekst>' }
        const net = m[3]!.toLowerCase()
        if (!NETS.includes(net)) return { text: `Nepoznata mreža "${m[3]}". Ide: ${NETS.join(', ')}.` }
        const when = m[2] ? `${m[1]} ${m[2]!.padStart(5, '0')}` : m[1]!
        posts.push({ when, net, text: m[4]!.trim() })
        await save($, path, posts)
        text = `Zakazano ${when} · ${net}. Objavljuješ ti; ovdje je samo raspored.\n\n${list(await load($, path), today)}`
      } else if (verb === 'objavljeno' || verb === 'obrisi') {
        const n = Number(rest[0])
        const post = posts[n - 1]
        if (!post) return { text: `Nema objave broj ${rest[0] ?? ''}.\n\n${list(posts, today)}` }
        if (verb === 'objavljeno') post.done = true
        else posts.splice(n - 1, 1)
        await save($, path, posts)
        text = `${verb === 'objavljeno' ? 'Označeno kao objavljeno' : 'Obrisano'}: ${post.when} · ${post.net}\n\n${list(await load($, path), today)}`
      } else return { text: 'Upotreba: /objave | /objave dodaj YYYY-MM-DD [HH:MM] <mreža> <tekst> | /objave objavljeno <n> | /objave obrisi <n>' }

      await status($, path)
      return { text }
    } catch (err) {
      return { text: `objave: ${String((err as Error)?.message ?? err)}` }
    }
  })
}
