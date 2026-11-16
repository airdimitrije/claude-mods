import { expect, test } from 'claude-code/testing'

const ROUTES: Record<string, unknown> = {
  '/api/v1/workflows?limit=250': { data: [
    { id: '1', name: 'Prijava lead-a', active: true, updatedAt: 'u1', nodes: [] },
    { id: '2', name: 'Backup', active: false, updatedAt: 'u2' },
  ] },
  '/api/v1/executions?status=error&limit=50': { data: [
    { id: '91', workflowId: '1', status: 'error', startedAt: '2026-11-16T08:00' },
    { id: '90', workflowId: '1', status: 'error', startedAt: '2026-11-15T08:00' },
  ] },
  '/api/v1/executions/91?includeData=true': {
    id: '91', workflowId: '1', status: 'error', startedAt: '2026-11-16T08:00',
    data: { resultData: { lastNodeExecuted: 'HTTP Request', error: { message: 'getaddrinfo ENOTFOUND api.example', node: { name: 'HTTP Request' } } } },
  },
}

function engine(on: any, key: string | undefined, seen: { url: string; headers: any }[]) {
  on('command.register', () => ({ value: { command: 'n8n' } }))
  on('tool.register', (_: any, e: any) => ({ value: { tool: `mcp__n8n__${e.name}` } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'N8N_API_KEY' ? key : undefined }))
  on('http.fetch', (_: any, e: any) => {
    seen.push({ url: e.url, headers: e.init?.headers })
    const path = e.url.replace('http://localhost:5678', '')
    const body = ROUTES[path]
    return { value: body ? { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } : { status: 404, ok: false, headers: {}, text: 'nf' } }
  })
}

test('/n8n sums up failures per workflow, with the key in the header', async ($, on) => {
  const seen: { url: string; headers: any }[] = []
  engine(on, 'k-123', seen)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as any)
  const r = await $.command.run({ command: 'n8n' } as any)
  expect(r.text).toMatch(/2 tokova, 1 aktivnih/)
  expect(r.text).toMatch(/Prijava lead-a \(1\): 2×, zadnje 2026-11-16T08:00 \(izvršavanje 91\)/)
  expect(seen[0]?.headers['X-N8N-API-KEY']).toBe('k-123')
})

test('the model reads why an execution failed', async ($, on) => {
  engine(on, 'k-123', [])
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as any)
  const r: any = await $.tool.call({ tool: 'mcp__n8n__n8n_execution', id: '91' } as any)
  expect(r.result).toMatchObject({ node: 'HTTP Request', message: 'getaddrinfo ENOTFOUND api.example' })
})

test('without N8N_API_KEY it says how to set one, and calls nothing', async ($, on) => {
  const seen: { url: string; headers: any }[] = []
  engine(on, undefined, seen)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as any)
  expect((await $.command.run({ command: 'n8n' } as any)).text).toMatch(/N8N_API_KEY nije postavljen/)
  const r: any = await $.tool.call({ tool: 'mcp__n8n__n8n_workflows' } as any)
  expect(r.deny).toMatch(/N8N_API_KEY/)
  expect(seen).toEqual([])
})
