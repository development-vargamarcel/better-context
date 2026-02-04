# btca

A CLI tool for asking questions about technologies using their source code repositories.

## Installation

```bash
bun install
```

## Usage

```bash
bun run src/index.ts
```

Or after building:

```bash
btca <command>
```

## Commands

### `btca`

Show version information.

### `btca ask`

Ask a question about a technology.

```bash
btca ask -t <tech> -q <question>
btca ask --tech svelte --question "How do I create a reactive store?"
```

Options:

- `-t, --tech` - The technology/repo to query
- `-q, --question` - The question to ask

### `btca chat`

Start an interactive TUI chat session.

```bash
btca chat -t <tech>
btca chat --tech nextjs
```

Options:

- `-t, --tech` - The technology/repo to chat about

### `btca browse`

Open the local repository directory in your system's file explorer.

```bash
btca browse -t <tech>
```

Options:

- `-t, --tech` - The technology/repo to browse

### `btca web`

Open the remote repository URL in your default browser.

```bash
btca web -t <tech>
```

Options:

- `-t, --tech` - The technology/repo to view

### `btca search`

Search for code in the local repository.

```bash
btca search -t <tech> -q <query>
btca search --tech svelte --query "writable"
```

Options:

- `-t, --tech` - The technology/repo to search
- `-q, --query` - The string or pattern to search for

### `btca info`

Show information about a configured repository, including local path and latest commit details.

```bash
btca info -t <tech>
```

Options:

- `-t, --tech` - The technology/repo to show info for

### `btca serve`

Start an HTTP server to answer questions via API.

```bash
btca serve
btca serve -p 3000
```

Options:

- `-p, --port` - Port to listen on (default: 8080)

Endpoint:

- `POST /question` - Send `{ "tech": "svelte", "question": "..." }` to get answers

### `btca open`

Hold an OpenCode instance in the background for faster subsequent queries.

```bash
btca open
```

### `btca history`

Manage and view your question history.

#### `btca history list`

List the most recent questions and answers.

```bash
btca history list
```

#### `btca history clear`

Clear all history.

```bash
btca history clear
```

### `btca config`

Manage CLI configuration. Shows the config file path when run without subcommands.

```bash
btca config
```

#### `btca config model`

View or set the model and provider.

```bash
# View current model/provider
btca config model

# Set model and provider
btca config model -p <provider> -m <model>
btca config model --provider anthropic --model claude-3-opus
```

Options:

- `-p, --provider` - The provider to use
- `-m, --model` - The model to use

Both options must be specified together when updating.

#### `btca config repos list`

List all configured repositories.

```bash
btca config repos list
```

#### `btca config repos add`

Add a new repository to the configuration.

```bash
btca config repos add -n <name> -u <url> [-b <branch>] [--notes <notes>]
btca config repos add --name react --url https://github.com/facebook/react --branch main
```

Options:

- `-n, --name` - Unique name for the repo (required)
- `-u, --url` - Git repository URL (required)
- `-b, --branch` - Branch to use (default: "main")
- `--notes` - Special instructions for the AI when using this repo

#### `btca config repos remove`

Remove a repository from the configuration.

```bash
btca config repos remove -n <name> [-d]
btca config repos remove --name react --delete-files
```

Options:

- `-n, --name` - Name of the repo to remove (required)
- `-d, --delete-files` - Delete the cloned repository directory from disk

#### `btca config reset`

Resets the configuration to default values.

```bash
btca config reset
```

### `btca update`

Updates (git pull) all configured repositories.

```bash
btca update
```

### `btca status`

Check the sync status of repositories (behind/ahead/dirty).

```bash
btca status
btca status -t <tech>
```

Options:

- `-t, --tech` - The technology/repo to check status for. If omitted, checks all.

### `btca doctor`

Checks the health of your environment, including:
- Bun version
- Git version and configuration (user.name/user.email)
- OpenCode installation
- Config file access

```bash
btca doctor
```

## Debugging

To enable debug logging, set the `EFFECT_LOG_LEVEL` environment variable to `DEBUG` (or `INFO`, `WARN`, `ERROR`).

```bash
EFFECT_LOG_LEVEL=DEBUG btca ask -t svelte -q "How do stores work?"
```

## Configuration

Configuration is stored at `~/.config/btca/btca.json`. The config file includes:

- `promptsDirectory` - Directory for system prompts
- `reposDirectory` - Directory where repos are cloned
- `port` - Default server port
- `maxInstances` - Maximum concurrent OpenCode instances
- `repos` - Array of configured repositories
- `model` - AI model to use
- `provider` - AI provider to use
