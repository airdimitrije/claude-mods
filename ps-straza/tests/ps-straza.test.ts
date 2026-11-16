import { expect, test } from 'claude-code/testing'

import { judge } from '../hooks/register'

test('the rules: what is refused, what is asked, what passes', () => {
  const deny = [
    'Format-Volume -DriveLetter D',
    'Get-Disk 1 | Clear-Disk -RemoveData',
    'diskpart /s wipe.txt',
    'codex exec --dangerously-bypass-approvals-and-sandbox "x"',
    'Remove-Item -Recurse -Force C:\\',
    'Remove-Item C:\\ -Recurse',
    'rm -rf /',
    'rm -rf ~',
    'rm -rf /c/Users/LEGION',
    'Remove-Item -Recurse -Force $HOME',
    'Remove-Item -Recurse "C:\\Users\\LEGION\\"',
    'cd x; rd /s /q D:\\',
  ]
  const ask = [
    'git push --force origin main',
    'git push -f',
    'git push origin +main',
    'git reset --hard HEAD~3',
    'git clean -fdx',
    'psql -c "DROP TABLE users"',
    'Restart-Computer',
    'reg delete HKLM\\Software\\X /f',
    'Remove-Item HKLM:\\Software\\X',
    'vercel deploy --prod',
    'Set-ExecutionPolicy Bypass',
  ]
  const pass = [
    'git push origin main',
    'git status',
    'Remove-Item -Recurse -Force .\\dist',
    'rm -rf node_modules',
    'Remove-Item -Recurse C:\\Users\\LEGION\\tmp\\build',
    'vercel deploy',
    'Get-ChildItem C:\\',
  ]
  for (const c of deny) expect([c, judge(c)?.decision]).toEqual([c, 'deny'])
  for (const c of ask) expect([c, judge(c)?.decision]).toEqual([c, 'ask'])
  for (const c of pass) expect([c, judge(c)]).toEqual([c, undefined])
})

test('the guard only tightens the engine verdict', async ($, on) => {
  let beneath: 'allow' | 'ask' | 'deny' = 'allow'
  on('tool.check', () => ({ decision: beneath }))

  const check = (tool: string, command: string) => $.tool.check({ tool, input: { command } })

  expect((await check('PowerShell', 'Format-Volume -DriveLetter D')).decision).toBe('deny')
  expect((await check('Bash', 'rm -rf ~')).decision).toBe('deny')
  expect((await check('PowerShell', 'git reset --hard')).decision).toBe('ask') // an allow rule beneath does not let it through
  expect((await check('PowerShell', 'git status')).decision).toBe('allow')

  beneath = 'deny'
  expect((await check('Bash', 'git push --force')).decision).toBe('deny') // a deny beneath stands

  beneath = 'allow'
  expect((await check('Read', 'rm -rf ~')).decision).toBe('allow') // other tools are not its business
})
