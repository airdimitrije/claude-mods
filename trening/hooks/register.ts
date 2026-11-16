import type { Register } from 'claude-code'

// trening: /trening <log> watches a training log. Every POLL_MS it reads the
// tail, shows loss / step / ETA / GPU in the status line, and pushes to the
// phone once when the run finishes, crashes, or the log stops growing.

const POLL_MS = 20_000
const STALL_MS = 10 * 60 * 1000
const TAIL_CHARS = 20_000

export type Reading = {
  loss?: number
  step?: [number, number]
  eta?: string
  state: 'running' | 'done' | 'crashed'
  error?: string
}

function lastMatch(text: string, re: RegExp): RegExpExecArray | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let last: RegExpExecArray | null = null
  for (let m = g.exec(text); m !== null; m = g.exec(text)) last = m
  return last
}

// Pure: what the tail of a log says. Exported for tests.
export function parse(tail: string): Reading {
  const r: Reading = { state: 'running' }
  const loss = lastMatch(tail, /\bloss\b["']?\s*[=:]?\s*([0-9]*\.?[0-9]+(?:[eE][-+]?\d+)?)/i)
  if (loss) r.loss = Number(loss[1])
  const step = lastMatch(tail, /\b(\d+)\s*\/\s*(\d+)\b/)
  if (step && Number(step[2]) > 0) r.step = [Number(step[1]), Number(step[2])]
  const eta = lastMatch(tail, /\[[\d:]+<([\d:]+)/) ?? lastMatch(tail, /\bETA\b[:=\s]+([\dhms:]+(?: [\dhms:]+)*)/i)
  if (eta) r.eta = eta[1]!.trim()
  const err = lastMatch(tail, /(CUDA out of memory|OutOfMemoryError|Traceback \(most recent call last\)|\bKilled\b|Segmentation fault)/)
  const done = lastMatch(tail, /(training (?:complete|completed|finished|done)|finished training|saving final model)/i)
  if (err && (!done || err.index > done.index)) {
    r.state = 'crashed'
    // Inside a traceback the last "XxxError: ..." line says it best; else the line that matched
    const tb = lastMatch(tail, /Traceback \(most recent call last\)/)
    const from = tb && tb.index <= err.index ? tb.index : err.index
    const lines = tail.slice(from).trim().split(/\r?\n/)
    r.error = (lines.filter(l => /^[\w.]*(Error|Exception)\b/.test(l)).pop() ?? lines[0] ?? '').trim().slice(0, 160)
  } else if (done) {
    r.state = 'done'
  }
  return r
}

export function line(r: Reading, gpu?: string) {
  const bits = ['trening']
  if (r.step) bits.push(`${r.step[0]}/${r.step[1]}`)
  if (r.loss !== undefined) bits.push(`loss ${r.loss}`)
  if (r.eta) bits.push(`ETA ${r.eta}`)
  if (gpu) bits.push(gpu)
  if (r.state !== 'running') bits.push(r.state === 'done' ? 'gotovo' : 'PUKLO')
  return bits.join(' · ')
}

let path = ''
let timer: { cancel(): void } | null = null
let lastSize = -1
let lastGrowth = 0
let hasPushed = false
let last: Reading = { state: 'running' }
let lastGpu = ''

async function gpu($: any): Promise<string> {
  try {
    const r = await $.process.run(
      ['nvidia-smi', '--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeoutMs: 10_000 },
    )
    const [util = NaN, used = NaN, total = NaN] = (String(r.stdout).split(/\r?\n/)[0] ?? '').split(',').map((s: string) => Number(s.trim()))
    if (r.exitCode !== 0 || [util, used, total].some(Number.isNaN)) return ''
    return `GPU ${util}% ${(used / 1024).toFixed(1)}/${(total / 1024).toFixed(1)}G`
  } catch {
    return ''
  }
}

async function push($: any, message: string) {
  if (hasPushed) return
  hasPushed = true
  $.ui.toast(message)
  try {
    await $.tool.call({ tool: 'PushNotification', message: message.slice(0, 190) })
  } catch {}
}

const fileName = () => path.split(/[\\/]/).pop()

export async function poll($: any) {
  if (path === '') return
  const now = await $.clock.now()
  let size: number
  try {
    size = (await $.fs.stat(path)).size
  } catch {
    $.ui.status(`trening · ne vidim ${fileName()}`)
    return
  }
  if (size !== lastSize) {
    lastSize = size
    lastGrowth = now
  }
  const text = String(await $.fs.read(path))
  last = parse(text.slice(-TAIL_CHARS))
  lastGpu = await gpu($)
  $.ui.status(line(last, lastGpu))
  if (last.state === 'crashed') await push($, `Trening PUKAO (${fileName()}): ${last.error}`)
  else if (last.state === 'done') await push($, `Trening gotov (${fileName()})${last.loss !== undefined ? `, loss ${last.loss}` : ''}`)
  else if (now - lastGrowth > STALL_MS) await push($, `Trening stoji: ${fileName()} nije rastao ${Math.round((now - lastGrowth) / 60000)} min`)
}

function stop($: any) {
  timer?.cancel()
  timer = null
  path = ''
  $.ui.status(undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'trening', description: 'Prati log treninga: /trening <putanja>, /trening stop, /trening za stanje' })
    } catch (err) {
      $.ui.log('trening: /trening not registered: ' + String((err as Error)?.message ?? err))
    }
    return next(e)
  })

  on('command.run', { command: 'trening' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().replace(/^["']|["']$/g, '')
    if (arg === 'stop') {
      const was = fileName()
      stop($)
      return { text: was ? `Više ne pratim ${was}.` : 'Ništa se nije pratilo.' }
    }
    if (arg === '') {
      if (path === '') return { text: 'Ništa ne pratim. /trening <putanja do loga>' }
      await poll($)
      return { text: `${path}\n${line(last, lastGpu)}` }
    }
    let base = '.'
    try {
      const here: any = await $.session.cwd()
      base = typeof here === 'string' ? here : here.path
    } catch {}
    const full = /^([A-Za-z]:)?[\\/]/.test(arg) ? arg : `${base}/${arg}`
    if (!(await $.fs.exists(full))) return { text: `Nema fajla: ${full}` }
    stop($)
    path = full
    lastSize = -1
    hasPushed = false
    last = { state: 'running' }
    await poll($)
    try {
      timer = $.clock.every(POLL_MS, () => void poll($).catch(() => {}))
    } catch {}
    return { text: `Pratim ${full} na ${POLL_MS / 1000}s. ${line(last, lastGpu)}` }
  })
}
