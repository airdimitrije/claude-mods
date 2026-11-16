import type { Register } from 'claude-code'

// n8n: read-only view of the local n8n (http://localhost:5678, or N8N_URL).
// Gives the model four tools — workflows, executions, one execution's error,
// one workflow's nodes — so it can find what broke and propose the fix; and
// /n8n, a summary for the person. The API key comes from N8N_API_KEY and is
// never written anywhere. Nothing here changes a workflow.

const DEFAULT_URL = 'http://localhost:5678'
const MAX_TEXT = 30_000

export class N8nError extends Error {}

async function api($: any, path: string): Promise<any> {
  const key = await $.env.get('N8N_API_KEY')
  if (!key) throw new N8nError('N8N_API_KEY nije postavljen. n8n → Settings → n8n API → Create API key, pa ga upiši kao korisničku env varijablu i restartuj Claude.')
  const base = String((await $.env.get('N8N_URL')) || DEFAULT_URL).replace(/\/+$/, '')
  let r
  try {
    r = await $.http.fetch(`${base}/api/v1${path}`, { headers: { 'X-N8N-API-KEY': key, accept: 'application/json' } })
  } catch (err) {
    throw new N8nError(`n8n se ne javlja na ${base}: ${String((err as Error)?.message ?? err)}`)
  }
  if (r.status === 401) throw new N8nError('n8n odbija ključ (401): N8N_API_KEY je pogrešan ili istekao.')
  if (!r.ok) throw new N8nError(`n8n ${path}: HTTP ${r.status} ${r.text.slice(0, 300)}`)
  return JSON.parse(r.text)
}

const q = (params: Record<string, unknown>) => {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
  return s ? `?${s}` : ''
}

// The failing node and message out of one execution's data
export function failure(ex: any) {
  const rd = ex?.data?.resultData ?? {}
  const err = rd.error ?? {}
  return {
    id: ex?.id,
    workflowId: ex?.workflowId,
    status: ex?.status,
    startedAt: ex?.startedAt,
    node: err.node?.name ?? rd.lastNodeExecuted,
    message: err.message ?? err.description,
    description: err.description !== err.message ? err.description : undefined,
  }
}

const slim = (w: any) => ({ id: w.id, name: w.name, active: w.active, updatedAt: w.updatedAt })

export async function summary($: any): Promise<string> {
  const flows = (await api($, '/workflows' + q({ limit: 250 }))).data as any[]
  const failed = (await api($, '/executions' + q({ status: 'error', limit: 50 }))).data as any[]
  const names = new Map(flows.map(w => [String(w.id), w.name]))
  const byFlow = new Map<string, number>()
  for (const ex of failed) byFlow.set(String(ex.workflowId), (byFlow.get(String(ex.workflowId)) ?? 0) + 1)
  const lines = [`n8n: ${flows.length} tokova, ${flows.filter(w => w.active).length} aktivnih. Posljednjih ${failed.length} neuspjelih izvršavanja:`]
  for (const [id, n] of [...byFlow].sort((a, b) => b[1] - a[1])) {
    const latest = failed.find(ex => String(ex.workflowId) === id)
    lines.push(`- ${names.get(id) ?? id} (${id}): ${n}×, zadnje ${latest?.startedAt ?? '?'} (izvršavanje ${latest?.id})`)
  }
  if (failed.length === 0) lines.push('- nema grešaka')
  return lines.join('\n')
}

const TOOLS = [
  {
    name: 'n8n_workflows',
    description: 'List workflows in the local n8n: id, name, active, updatedAt. Read-only.',
    inputSchema: { type: 'object', properties: { active: { type: 'boolean', description: 'Only active (true) or inactive (false)' } } },
  },
  {
    name: 'n8n_executions',
    description: 'List recent executions of the local n8n, newest first. Use status "error" to find what broke. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['error', 'success', 'waiting'] },
        workflowId: { type: 'string' },
        limit: { type: 'number', description: 'Default 20, at most 100' },
      },
    },
  },
  {
    name: 'n8n_execution',
    description: 'One n8n execution: the failing node and its error message. Read-only.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'n8n_workflow',
    description: 'One n8n workflow: its nodes (name, type, parameters) and connections, to see why it fails. Read-only; propose changes to the person, do not claim to apply them.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
]

async function answer($: any, name: string, e: any): Promise<unknown> {
  switch (name) {
    case 'n8n_workflows': {
      const flows = ((await api($, '/workflows' + q({ limit: 250, active: e.active }))).data as any[]).map(slim)
      return { workflows: flows }
    }
    case 'n8n_executions': {
      const limit = Math.min(100, Math.max(1, Number(e.limit) || 20))
      const list = (await api($, '/executions' + q({ status: e.status, workflowId: e.workflowId, limit }))).data as any[]
      return { executions: list.map(x => ({ id: x.id, workflowId: x.workflowId, status: x.status, mode: x.mode, startedAt: x.startedAt, stoppedAt: x.stoppedAt })) }
    }
    case 'n8n_execution':
      return failure(await api($, `/executions/${encodeURIComponent(String(e.id))}` + q({ includeData: true })))
    case 'n8n_workflow': {
      const w = await api($, `/workflows/${encodeURIComponent(String(e.id))}`)
      const body = JSON.stringify({ ...slim(w), nodes: w.nodes, connections: w.connections })
      return body.length > MAX_TEXT ? { ...slim(w), truncated: true, json: body.slice(0, MAX_TEXT) } : JSON.parse(body)
    }
  }
  throw new N8nError(`unknown tool ${name}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'n8n', description: 'Pregled lokalnog n8n-a: tokovi i posljednje greške' })
      for (const tool of TOOLS) await $.tool.register({ ...tool, isDeferred: true })
    } catch (err) {
      $.ui.log('n8n: not registered: ' + String((err as Error)?.message ?? err))
    }
    return next(e)
  })

  for (const tool of TOOLS) {
    on('tool.call', { tool: `mcp__n8n__${tool.name}` } as any, async ($: any, e: any) => {
      try {
        return { result: await answer($, tool.name, e) }
      } catch (err) {
        return { deny: String((err as Error)?.message ?? err) }
      }
    })
  }

  on('command.run', { command: 'n8n' }, async $ => {
    try {
      return { text: await summary($) }
    } catch (err) {
      return { text: String((err as Error)?.message ?? err) }
    }
  })
}
