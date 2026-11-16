# claude-mods

Mods for Claude Code: panes, bands, slash commands and hooks that change how a session looks and behaves. Each mod lives in its own folder with a `.claude-plugin/plugin.json`, a hooks module and tests; this repository is also a marketplace listing all of them.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install <mod> --marketplace airdimitrije/claude-mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install <mod> --marketplace airdimitrije/claude-mods
```

## Mods

| Mod | What it does |
| --- | --- |
| `brain-dump` | Catches a long messy prompt, asks a few questions about it, and sends it as the task, the why, the guardrails and what done looks like |
| `cache-clock` | Counts down to the moment this chat's prompt cache goes cold, and can keep it warm with one cheap touch |
| `chat-inventory` | /inventory shows the goal, the task list, every connector and skill used, and the files touched in this chat |
| `dokument` | Fills a template from sabloni/ ({{field}} placeholders) into a new dated file; never overwrites, never writes with a field missing |
| `handoff` | Writes tasks/handoff.md for a fresh chat (at 110k tokens, when the chat goes cold, or on /handoff) and offers a new session that starts with it as context |
| `helper-desk` | A progress band above the prompt and a panel with one row per subagent: its colour, its progress and what it cost |
| `n8n` | Read-only view of the local n8n: workflows, failed executions and why they failed, as tools for Claude and a /n8n summary |
| `novi-klijent` | Sets up a new client app step by step (GitHub repo, Vercel, Neon, dimi-cli registry); each step shows its command and runs only after an explicit da |
| `objave` | Social media posting schedule in objave.json, with what is due today in the status line; never posts anything itself |
| `ps-straza` | Shell guard: refuses disk-wiping commands outright and asks before force-push, hard reset, DROP, reboot, HKLM edits and production deploys |
| `reflect` | Catches a hard standing rule in a prompt and asks where to save it: memory, CLAUDE.md, or the vault |
| `replay-theater` | /replay steps through every change Claude made to a file in this chat and puts an earlier version back |
| `screen-share` | /screen-share replaces emails, phone numbers, money amounts and words you name with grey bars, so the screen is safe to show |
| `switchboard` | /mods lists every mod on this machine and toggles it or its panes off |
| `tabla` | One pane for every open Claude session (project, state, context) and a phone push when a long turn ends or a session asks for permission |
| `trening` | Watches an ML training log: loss, step, ETA and GPU in the status line, and a phone push when training finishes, crashes or stalls |
| `veliki-izlaz` | Warns when a tool's output in the main thread passes ~15k tokens: a toast for the person and a nudge for the model to delegate such work to a subagent |

`switchboard` (`/mods`) turns the others on and off without uninstalling them.

## Developing

Each mod checks with `claude plugin validate <mod>`, `claude plugin test <mod>`, and `tsc -p <mod>` for the TypeScript ones. Run one from its folder with `claude --plugin-dir <mod>`.

## License

MIT, see [LICENSE](LICENSE).
