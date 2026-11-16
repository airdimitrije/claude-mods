import type { Register } from 'claude-code'

// veliki-izlaz: tool output in the main thread is paid for again on every
// later call until compaction. Past ~15k tokens, say so: a toast for the
// person, one line of context for the model. Read is left alone (a file read
// whole is usually wanted verbatim), and so are subagents (their output is
// paid for once).

const LIMIT_TOKENS = 15_000
const SKIP = new Set(['Read'])

export const tokensOf = (text: string) => Math.round(text.length / 4)

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || SKIP.has(e.tool) || 'deny' in r && r.deny !== undefined) return r
    const tokens = tokensOf(r.text ?? JSON.stringify(r.result ?? ''))
    if (tokens <= LIMIT_TOKENS) return r
    const k = Math.round(tokens / 1000)
    $.ui.toast(`veliki-izlaz: ${e.tool} vratio ~${k}k tokena u glavnu nit`)
    return {
      ...r,
      context: [
        ...(r.context ?? []),
        `This ${e.tool} output was ~${k}k tokens in the main thread. Output this size is paid again on every later call until compaction: for similar searches, logs, builds or reports, delegate to a subagent and have it return only what is needed.`,
      ],
    }
  }).catch(($, e, next) => next(e)) // a warning that failed must never cost the result
}
