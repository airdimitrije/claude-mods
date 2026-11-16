import type { Register } from 'claude-code'

// ps-straza: a guard on shell commands (PowerShell and Bash).
// "deny" commands never run; "ask" commands always reach the person,
// even when a rule or the mode would have let them through.

type Verdict = { decision: 'deny' | 'ask'; reason: string }

const DENY: [RegExp, string][] = [
  [/\b(format-volume|clear-disk|initialize-disk|diskpart|mkfs(\.\w+)?)\b/i, 'formatira ili briše disk'],
  [/--dangerously-bypass/i, 'zaobilazi sandbox i dozvole'],
]

const ASK: [RegExp, string][] = [
  [/\bgit\b[^;|&\n]*\bpush\b[^;|&\n]*(\s--force(-with-lease)?\b|\s-f\b|\s\+\S)/i, 'git push --force prepisuje udaljenu istoriju'],
  [/\bgit\b[^;|&\n]*\breset\b[^;|&\n]*--hard\b/i, 'git reset --hard baca nesačuvane izmjene'],
  [/\bgit\b[^;|&\n]*\bclean\b[^;|&\n]*\s-[a-z]*f/i, 'git clean -f briše nepraćene fajlove'],
  [/\bdrop\s+(table|database|schema)\b/i, 'DROP briše podatke iz baze'],
  [/\b(stop-computer|restart-computer|shutdown(\.exe)?)\b/i, 'gasi ili restartuje računar'],
  [/\breg(\.exe)?\s+delete\s+(hklm|hkey_local_machine)\b|\bremove-item(property)?\b[^;|&\n]*\bhklm:/i, 'briše iz HKLM registra'],
  [/\bvercel\b[^;|&\n]*\s--prod\b/i, 'deploy na produkciju'],
  [/\bset-executionpolicy\b/i, 'mijenja PowerShell execution policy'],
]

const DELETE_VERB = /^(remove-item|rm|ri|del|erase|rd|rmdir)$/i
const RECURSE_FLAG = /^(-r|-rf|-fr|-recurse|-recurse:\$true|\/s|--recursive)$/i

// A target whose recursive delete takes a whole drive, the system or a home folder.
function isRootTarget(raw: string): boolean {
  const t = raw.replace(/^['"]|['"]$/g, '').replace(/[\\/]\*?$/, '').replace(/[\\/]+$/, '').toLowerCase()
  return (
    t === '' || // "/" or "\" after the trailing slash came off
    /^[a-z]:$/.test(t) ||
    /^\/[a-z]$/.test(t) || // Git Bash drive root, /c
    ['~', '$home', '$env:userprofile', '$env:homedrive', '$env:systemroot', '%userprofile%', 'c:\\windows', 'c:/windows', '/c/windows'].includes(t) ||
    /^([a-z]:|\/[a-z])[\\/]users([\\/][^\\/]+)?$/.test(t) ||
    /^\/home(\/[^/]+)?$/.test(t)
  )
}

export function judge(command: string): Verdict | undefined {
  for (const [re, why] of DENY) if (re.test(command)) return { decision: 'deny', reason: `ps-straza: ${why}.` }
  for (const segment of command.split(/[;|&\n]+/)) {
    const words = segment.trim().split(/\s+/)
    if (!DELETE_VERB.test(words[0] ?? '')) continue
    const flags = words.slice(1).filter(w => w.startsWith('-') || w.startsWith('/'))
    const isRecursive = flags.some(f => RECURSE_FLAG.test(f)) || /^(rd|rmdir)$/i.test(words[0]!) && flags.some(f => /^\/s$/i.test(f))
    const targets = words.slice(1).filter(w => !RECURSE_FLAG.test(w) && !/^-(force|confirm|path|literalpath|erroraction)/i.test(w))
    if (isRecursive && targets.some(isRootTarget))
      return { decision: 'deny', reason: 'ps-straza: rekurzivno brisanje diska, sistema ili home foldera.' }
  }
  for (const [re, why] of ASK) if (re.test(command)) return { decision: 'ask', reason: `ps-straza: ${why}.` }
  return undefined
}

export const register: Register = on => {
  for (const tool of ['PowerShell', 'Bash']) {
    on('tool.check', { tool }, async ($, e, next) => {
      const command = String((e.input as { command?: unknown })?.command ?? '')
      const v = judge(command)
      if (v?.decision === 'deny') return v
      const beneath = await next(e)
      // Only tighten: an ask stays an ask, a deny beneath stays a deny.
      if (v && beneath.decision === 'allow') return v
      return beneath
    }).catch(() => ({ decision: 'deny', reason: 'ps-straza: provjera nije uspjela, komanda nije puštena.' }))
  }
}
