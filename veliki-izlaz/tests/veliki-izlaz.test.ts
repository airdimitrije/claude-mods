import { expect, test } from 'claude-code/testing'

test('a large output in the main thread gets a toast and a nudge; others pass untouched', async ($, on) => {
  const toasts: string[] = []
  let size = 0
  on('tool.call', () => ({ result: {}, text: 'x'.repeat(size) }))
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); return { value: undefined } })

  size = 100_000 // ~25k tokens
  const big = await $.tool.call({ tool: 'Bash', command: 'cat big.log' } as any)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/Bash vratio ~25k/)
  expect(big.context?.at(-1)).toMatch(/delegate to a subagent/)

  const read = await $.tool.call({ tool: 'Read', file_path: 'a.ts' } as any)
  expect(read.context).toBeUndefined()

  const sub = await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'a1' } as any)
  expect(sub.context).toBeUndefined()

  size = 40_000 // ~10k tokens
  const small = await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  expect(small.context).toBeUndefined()
  expect(toasts.length).toBe(1)
})
