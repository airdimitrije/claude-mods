import { expect, test } from 'claude-code/testing'
import { parse } from '../hooks/register'

const norm = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

test('parse reads tqdm, HF-style and keras-style lines', () => {
  const tqdm = parse('Epoch 2:  45%|████▌     | 450/1000 [03:12<03:55,  2.34it/s, loss=0.4321]\n')
  expect(tqdm).toEqual({ state: 'running', loss: 0.4321, step: [450, 1000], eta: '03:55' })

  const hf = parse("{'loss': 1.25e-1, 'learning_rate': 2e-5, 'epoch': 0.5}\nstep 120/400 ETA: 1h 2m\n")
  expect(hf.loss).toBe(0.125)
  expect(hf.step).toEqual([120, 400])
  expect(hf.eta).toBe('1h 2m')

  const done = parse('step 400/400 loss 0.09\nTraining complete. Saving final model\n')
  expect(done.state).toBe('done')

  const crash = parse('step 10/400 loss 2.1\nTraceback (most recent call last):\n  File "train.py", line 9\ntorch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2 GiB\n')
  expect(crash.state).toBe('crashed')
  expect(crash.error).toMatch(/OutOfMemoryError/)
})

test('/trening watches a log, shows status and pushes once when it crashes', async ($, on) => {
  const files = new Map<string, string>()
  const pushes: string[] = []
  const statuses: (string | undefined)[] = []
  const now = [1_000_000]
  on('command.register', () => ({ value: { command: 'trening' } }))
  on('clock.every', () => ({ deny: 'no timers in tests' }))
  on('clock.now', () => ({ value: now[0]! }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/runs' }))
  on('fs.exists', (_: any, e: any) => ({ value: files.has(norm(e.path)) }))
  on('fs.stat', (_: any, e: any) => {
    const t = files.get(norm(e.path))
    return t === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file', size: t.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', (_: any, e: any) => ({ value: files.get(norm(e.path)) ?? '' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '87, 6144, 8192\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.status', (_: any, e: any) => { statuses.push(e.text); return { value: undefined } })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', (_: any, e: any) => { if (e.tool === 'PushNotification') pushes.push(e.message); return { result: {} } })

  await $.session.start({ cwd: '/runs', surface: 'terminal', isInteractive: true } as any)
  const missing = await $.command.run({ command: 'trening', args: 'nema.log' } as any)
  expect(missing.text).toMatch(/Nema fajla/)

  files.set('/runs/train.log', 'step 5/100 loss 3.2\n')
  const started = await $.command.run({ command: 'trening', args: 'train.log' } as any)
  expect(started.text).toMatch(/Pratim \/runs\/train.log/)
  expect(statuses.at(-1)).toBe('trening · 5/100 · loss 3.2 · GPU 87% 6.0/8.0G')

  files.set('/runs/train.log', 'step 5/100 loss 3.2\nTraceback (most recent call last):\nRuntimeError: CUDA error: device-side assert triggered\n')
  const status = await $.command.run({ command: 'trening' } as any)
  expect(status.text).toMatch(/PUKLO/)
  await $.command.run({ command: 'trening' } as any)
  expect(pushes).toEqual(['Trening PUKAO (train.log): RuntimeError: CUDA error: device-side assert triggered'])

  const stopped = await $.command.run({ command: 'trening', args: 'stop' } as any)
  expect(stopped.text).toMatch(/Više ne pratim train.log/)
  expect(statuses.at(-1)).toBeUndefined()
})
