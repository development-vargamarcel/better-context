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

Ask a question (interactive repo selection if `-t` is omitted):

```bash
btca ask -q "How do stores work in Svelte 5?"
# or specify tech
btca ask -t svelte -q "How do stores work in Svelte 5?"
```

Ask a question about the current directory:

```bash
btca ask -t local -q "How does this feature work?"
```

Explain a specific file:

```bash
btca explain -f src/lib/index.ts
# or
btca explain -t svelte -f src/runtime/index.ts
```

Get a summary of the repository:

```bash
btca summary
# or
btca summary -t svelte
```

Open the TUI:

```bash
btca chat
# or
btca chat -t svelte
```

Browse local repo:

```bash
btca browse
# or
btca browse -t svelte
```

Open in editor (uses $VISUAL, $EDITOR, or defaults to VS Code):

```bash
btca code
# or
btca code -t svelte
```

Search local repo:

```bash
btca search -q "writable"
# or
btca search -t svelte -q "writable"
```

Get repo info:

```bash
btca info
# or
btca info -t svelte
```

View git log:

```bash
btca log
# or
btca log -t svelte -n 20
# or see incoming changes
btca log -t svelte --incoming
```

View git diff:

```bash
btca diff
# or
btca diff -t svelte
# or staged changes
btca diff --cached
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

Clean local repos (removes files but keeps config):

```bash
btca clean
# or clean a specific repo
btca clean -t svelte
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

## Bookmarks

Manage bookmarked QA pairs:

```bash
# List all bookmarks
btca bookmark list

# Add a bookmark (interactive from recent history)
btca bookmark add

# Add a bookmark manually
btca bookmark add -q "Question" -a "Answer" -t "Tech"

# Remove a bookmark (interactive)
btca bookmark remove
```

## Backup & Restore

Export configuration to a file:

```bash
btca config export --path backup.json
```

Import configuration from a file:

```bash
btca config import --path backup.json
```
