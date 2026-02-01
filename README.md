# Better Context (`btca`)

https://btca.dev

`btca` is a CLI for asking questions about libraries/frameworks by cloning their repos locally and searching the source directly.

Dev docs are in the `apps/cli` directory.

## Install

```bash
bun add -g btca
btca --help
```

## Quick commands

Ask a question:

```bash
btca ask -t svelte -q "How do stores work in Svelte 5?"
```

Open the TUI:

```bash
btca chat -t svelte
```

Browse local repo:

```bash
btca browse -t svelte
```

Search local repo:

```bash
btca search -t svelte -q "writable"
```

Run as a server:

```bash
btca serve -p 8080
```

Then POST `/question` with:

```json
{ "tech": "svelte", "question": "how does the query remote function work in sveltekit?" }
```

Keep an OpenCode instance running:

```bash
btca open
```

View history:

```bash
btca history list
```

View history stats:

```bash
btca history stats
```

Export history:

```bash
btca history export --format markdown --output history.md
```

Check health:

```bash
btca doctor
```

Update all repos:

```bash
btca update
```

## Debugging

To enable debug logs, set `EFFECT_LOG_LEVEL=DEBUG`:

```bash
EFFECT_LOG_LEVEL=DEBUG btca ...
```

## Config

On first run, `btca` creates a default config at `~/.config/btca/btca.json`. That’s where the repo list + model/provider live.

## Managing Repos

Add a repo (validates URL automatically):

```bash
btca config repos add --name my-lib --url https://github.com/my/lib
```
