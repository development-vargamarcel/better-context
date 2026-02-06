import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Command, Options } from '@effect/cli';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { BunHttpServer } from '@effect/platform-bun';
import { Effect, Layer, Schema, Stream } from 'effect';
import { OcService, type OcEvent } from './oc.ts';
import { ConfigService } from './config.ts';
import { HistoryService } from './history.ts';
import { BookmarkService } from './bookmark.ts';
import { GeneralError } from '../lib/errors.ts';
import { selectRepo, promptSelection } from '../lib/ui.ts';
import { getLanguageBreakdown, getTopContributors, getTotalLines } from '../lib/git-stats.ts';

declare const __VERSION__: string;
const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

const programLayer = Layer.mergeAll(OcService.Default, ConfigService.Default, HistoryService.Default, BookmarkService.Default);

const handleAnswerStream = <R>(args: {
	eventStream: Stream.Stream<OcEvent, any>;
	history?: { addEntry: (entry: { tech: string; question: string; answer: string }) => Effect.Effect<any, any, R> };
	tech: string;
	question: string;
}) =>
	Effect.gen(function* () {
		let currentMessageId: string | null = null;
		let fullAnswer = '';

		yield* args.eventStream.pipe(
			Stream.runForEach((event) =>
				Effect.sync(() => {
					switch (event.type) {
						case 'message.part.updated':
							if (event.properties.part.type === 'text') {
								if (currentMessageId === event.properties.part.messageID) {
									const delta = event.properties.delta ?? '';
									process.stdout.write(delta);
									fullAnswer += delta;
								} else {
									currentMessageId = event.properties.part.messageID;
									const text = event.properties.part.text ?? '';
									process.stdout.write('\n\n' + text);
									fullAnswer += '\n\n' + text;
								}
							}
							break;
						default:
							break;
					}
				})
			)
		);

		if (fullAnswer.trim() && args.history) {
			yield* args.history.addEntry({ tech: args.tech, question: args.question, answer: fullAnswer.trim() });
		}

		console.log('\n');
	});

// === Ask Subcommand ===
const questionOption = Options.text('question').pipe(Options.withAlias('q'));
const techOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to ask a question about a technology.
 */
const askCommand = Command.make(
	'ask',
	{ question: questionOption, tech: techOption },
	({ question, tech }) =>
		Effect.gen(function* () {
			const selectedTech = yield* selectRepo(tech);
			yield* Effect.logDebug(
				`Command: ask, tech: ${selectedTech}, question: ${question}`
			);
			const oc = yield* OcService;
			const history = yield* HistoryService;
			const eventStream = yield* oc.askQuestion({ tech: selectedTech, question });

			yield* handleAnswerStream({
				eventStream,
				history,
				tech: selectedTech,
				question
			});
		}).pipe(
			Effect.catchTags({
				ConfigError: (e) =>
					Effect.sync(() => {
						console.error(`Error: ${e.message}`);
						process.exit(1);
					}),
				InvalidProviderError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Unknown provider "${e.providerId}"`);
						console.error(`Available providers: ${e.availableProviders.join(', ')}`);
						process.exit(1);
					}),
				InvalidModelError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Unknown model "${e.modelId}" for provider "${e.providerId}"`);
						console.error(`Available models: ${e.availableModels.join(', ')}`);
						process.exit(1);
					}),
				ProviderNotConnectedError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Provider "${e.providerId}" is not connected`);
						console.error(`Connected providers: ${e.connectedProviders.join(', ')}`);
						console.error(`Run "opencode auth" to configure provider credentials.`);
						process.exit(1);
					})
			}),
			Effect.provide(programLayer)
		)
);

// === Open Subcommand ===
/**
 * Command to hold an OpenCode instance open in the background.
 */
const openCommand = Command.make('open', {}, () =>
	Effect.gen(function* () {
		yield* Effect.logDebug(`Command: open`);
		const oc = yield* OcService;
		yield* oc.holdOpenInstanceInBg();
	}).pipe(Effect.provide(programLayer))
);

// === Chat Subcommand ===
const chatTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to start an interactive TUI chat session.
 */
const chatCommand = Command.make('chat', { tech: chatTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		const selectedTech = yield* selectRepo(tech);
		yield* Effect.logDebug(`Command: chat, tech: ${selectedTech}`);
		const oc = yield* OcService;
		yield* oc.spawnTui({ tech: selectedTech });
	}).pipe(
		Effect.catchTag('ConfigError', (e) =>
			Effect.sync(() => {
				console.error(`Error: ${e.message}`);
				process.exit(1);
			})
		),
		Effect.provide(programLayer)
	)
);

// === Web Subcommand ===
const webTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to open the repository URL in a web browser.
 */
const webCommand = Command.make('web', { tech: webTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		const selectedTech = yield* selectRepo(tech);
		yield* Effect.logDebug(`Command: web, tech: ${selectedTech}`);
		const config = yield* ConfigService;

		const repos = yield* config.getRepos();
		const repo = repos.find(r => r.name === selectedTech);

		if (!repo) {
			console.error(`Error: Repo "${selectedTech}" not found.`);
			process.exit(1);
		}

		yield* Effect.logInfo(`Opening ${repo.url}...`);

		// Determine command based on platform
		let command: string[];
		if (process.platform === 'darwin') {
			command = ['open', repo.url];
		} else if (process.platform === 'win32') {
			command = ['explorer', repo.url];
		} else {
			// Linux and others
			command = ['xdg-open', repo.url];
		}

		const proc = Bun.spawn(command, {
			stderr: 'ignore',
			stdout: 'ignore',
			stdin: 'ignore'
		});

		proc.unref();
	}).pipe(
		Effect.catchTag('ConfigError', (e) =>
			Effect.sync(() => {
				console.error(`Error: ${e.message}`);
				process.exit(1);
			})
		),
		Effect.provide(programLayer)
	)
);

// === Serve Subcommand ===
const QuestionRequest = Schema.Struct({
	tech: Schema.String,
	question: Schema.String
});

const portOption = Options.integer('port').pipe(Options.withAlias('p'), Options.withDefault(8080));

/**
 * Command to start an HTTP server for answering questions.
 */
const serveCommand = Command.make('serve', { port: portOption }, ({ port }) =>
	Effect.gen(function* () {
		yield* Effect.logDebug(`Command: serve, port: ${port}`);
		const router = HttpRouter.empty.pipe(
			HttpRouter.post(
				'/question',
				Effect.gen(function* () {
					const body = yield* HttpServerRequest.schemaBodyJson(QuestionRequest);
					const oc = yield* OcService;

					const eventStream = yield* oc.askQuestion({
						tech: body.tech,
						question: body.question
					});

					const chunks: string[] = [];
					let currentMessageId: string | null = null;
					yield* eventStream.pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => {
								switch (event.type) {
									case 'message.part.updated':
										if (event.properties.part.type === 'text') {
											if (currentMessageId === event.properties.part.messageID) {
												chunks[chunks.length - 1] += event.properties.delta ?? '';
											} else {
												currentMessageId = event.properties.part.messageID;
												chunks.push(event.properties.part.text ?? '');
											}
										}
										break;
									default:
										break;
								}
							})
						)
					);

					return yield* HttpServerResponse.json({ answer: chunks.join('') });
				})
			)
		);

		const ServerLive = BunHttpServer.layer({ port });

		const HttpLive = router.pipe(
			HttpServer.serve(),
			HttpServer.withLogAddress,
			Layer.provide(ServerLive)
		);

		return yield* Layer.launch(HttpLive);
	}).pipe(Effect.scoped, Effect.provide(programLayer))
);

// === History Subcommands ===

const historyListCommand = Command.make('list', {}, () =>
	Effect.gen(function* () {
		const history = yield* HistoryService;
		const entries = yield* history.getEntries(10);

		if (entries.length === 0) {
			console.log('No history found.');
			return;
		}

		console.log('Recent History:\n');
		for (const entry of entries) {
			const date = new Date(entry.timestamp).toLocaleString();
			console.log(`[${date}] ${entry.tech}`);
			console.log(`Q: ${entry.question}`);
			console.log(
				`A: ${entry.answer.substring(0, 100).replace(/\n/g, ' ')}${entry.answer.length > 100 ? '...' : ''}`
			);
			console.log('');
		}
	}).pipe(Effect.provide(programLayer))
);

const historyStatsCommand = Command.make('stats', {}, () =>
	Effect.gen(function* () {
		const history = yield* HistoryService;
		const stats = yield* history.getStats();

		console.log('History Statistics:\n');
		console.log(`Total Questions: ${stats.totalQuestions}`);
		if (stats.lastActivity > 0) {
			console.log(`Last Activity:   ${new Date(stats.lastActivity).toLocaleString()}`);
		}
		console.log('\nQuestions per Tech:');
		if (Object.keys(stats.techCounts).length === 0) {
			console.log('  None');
		} else {
			const sortedTechs = Object.entries(stats.techCounts).sort((a, b) => b[1] - a[1]);
			for (const [tech, count] of sortedTechs) {
				console.log(`  ${tech}: ${count}`);
			}
		}
	}).pipe(Effect.provide(programLayer))
);

const historyClearCommand = Command.make('clear', {}, () =>
	Effect.gen(function* () {
		const history = yield* HistoryService;
		yield* history.clearHistory();
		console.log('History cleared.');
	}).pipe(Effect.provide(programLayer))
);

const historyOutputOption = Options.text('output').pipe(Options.withAlias('o'));
const historyFormatOption = Options.text('format').pipe(
	Options.withAlias('f'),
	Options.withDefault('json')
);

const historyExportCommand = Command.make(
	'export',
	{ output: historyOutputOption, format: historyFormatOption },
	({ output, format }) =>
		Effect.gen(function* () {
			if (format !== 'json' && format !== 'markdown') {
				yield* Effect.fail(
					new GeneralError({ message: 'Format must be "json" or "markdown"' })
				);
			}
			const history = yield* HistoryService;
			yield* history.exportHistory(format as 'json' | 'markdown', output);
		}).pipe(
			Effect.catchTag('GeneralError', (e) =>
				Effect.sync(() => {
					console.error(`Error: ${e.message}`);
					process.exit(1);
				})
			),
			Effect.provide(programLayer)
		)
);

const historyCommand = Command.make('history', {}, () =>
	Effect.sync(() => {
		console.log('Usage: btca history <command>');
		console.log('');
		console.log('Commands:');
		console.log('  list    List recent history');
		console.log('  stats   Show history statistics');
		console.log('  clear   Clear history');
		console.log('  export  Export history to a file');
	})
).pipe(
	Command.withSubcommands([
		historyListCommand,
		historyStatsCommand,
		historyClearCommand,
		historyExportCommand
	])
);

// === Config Subcommands ===

// config model - view or set model/provider
const providerOption = Options.text('provider').pipe(Options.withAlias('p'), Options.optional);
const modelOption = Options.text('model').pipe(Options.withAlias('m'), Options.optional);

const configModelCommand = Command.make(
	'model',
	{ provider: providerOption, model: modelOption },
	({ provider, model }) =>
		Effect.gen(function* () {
			const config = yield* ConfigService;

			// If both options provided, update the config
			if (provider._tag === 'Some' && model._tag === 'Some') {
				const result = yield* config.updateModel({
					provider: provider.value,
					model: model.value
				});
				console.log(`Updated model configuration:`);
				console.log(`  Provider: ${result.provider}`);
				console.log(`  Model: ${result.model}`);
			} else if (provider._tag === 'Some' || model._tag === 'Some') {
				// If only one is provided, show an error
				console.error('Error: Both --provider and --model must be specified together');
				process.exit(1);
			} else {
				// No options, show current values
				const current = yield* config.getModel();
				console.log(`Current model configuration:`);
				console.log(`  Provider: ${current.provider}`);
				console.log(`  Model: ${current.model}`);
			}
		}).pipe(Effect.provide(programLayer))
);

// config repos list - list all repos
const configReposListCommand = Command.make('list', {}, () =>
	Effect.gen(function* () {
		const config = yield* ConfigService;
		const repos = yield* config.getRepos();

		if (repos.length === 0) {
			console.log('No repos configured.');
			return;
		}

		console.log('Configured repos:\n');
		for (const repo of repos) {
			console.log(`  ${repo.name}`);
			console.log(`    URL: ${repo.url}`);
			console.log(`    Branch: ${repo.branch}`);
			if (repo.specialNotes) {
				console.log(`    Notes: ${repo.specialNotes}`);
			}
			console.log();
		}
	}).pipe(Effect.provide(programLayer))
);

// config repos add - add a new repo
const repoNameOption = Options.text('name').pipe(Options.withAlias('n'));
const repoUrlOption = Options.text('url').pipe(Options.withAlias('u'));
const repoBranchOption = Options.text('branch').pipe(
	Options.withAlias('b'),
	Options.withDefault('main')
);
const repoNotesOption = Options.text('notes').pipe(Options.optional);

const configReposAddCommand = Command.make(
	'add',
	{
		name: repoNameOption,
		url: repoUrlOption,
		branch: repoBranchOption,
		notes: repoNotesOption
	},
	({ name, url, branch, notes }) =>
		Effect.gen(function* () {
			const config = yield* ConfigService;

			const repo = {
				name,
				url,
				branch,
				...(notes._tag === 'Some' ? { specialNotes: notes.value } : {})
			};

			yield* config.addRepo(repo);
			console.log(`Added repo "${name}":`);
			console.log(`  URL: ${url}`);
			console.log(`  Branch: ${branch}`);
			if (notes._tag === 'Some') {
				console.log(`  Notes: ${notes.value}`);
			}
		}).pipe(
			Effect.catchTag('ConfigError', (e) =>
				Effect.sync(() => {
					console.error(`Error: ${e.message}`);
					process.exit(1);
				})
			),
			Effect.provide(programLayer)
		)
);

// config repos remove - remove a repo
const deleteFilesOption = Options.boolean('delete-files').pipe(
	Options.withAlias('d'),
	Options.withDefault(false)
);

const configReposRemoveCommand = Command.make(
	'remove',
	{ name: repoNameOption, deleteFiles: deleteFilesOption },
	({ name, deleteFiles }) =>
		Effect.gen(function* () {
			const config = yield* ConfigService;
			yield* config.removeRepo({ name, deleteFiles });
			console.log(`Removed repo "${name}".`);
		}).pipe(
			Effect.catchTag('ConfigError', (e) =>
				Effect.sync(() => {
					console.error(`Error: ${e.message}`);
					process.exit(1);
				})
			),
			Effect.provide(programLayer)
		)
);

// config repos - parent command for repo subcommands
const configReposCommand = Command.make('repos', {}, () =>
	Effect.sync(() => {
		console.log('Usage: btca config repos <command>');
		console.log('');
		console.log('Commands:');
		console.log('  list    List all configured repos');
		console.log('  add     Add a new repo');
		console.log('  remove  Remove a repo');
	})
).pipe(
	Command.withSubcommands([
		configReposListCommand,
		configReposAddCommand,
		configReposRemoveCommand
	])
);

const configResetCommand = Command.make('reset', {}, () =>
	Effect.gen(function* () {
		const config = yield* ConfigService;
		yield* config.resetConfig();
		console.log('Configuration reset to defaults.');
	}).pipe(Effect.provide(programLayer))
);

// config export - export config to file
const configExportPathOption = Options.text('path').pipe(
	Options.withAlias('p'),
	Options.withDefault('btca-config.json')
);

const configExportCommand = Command.make(
	'export',
	{ path: configExportPathOption },
	({ path }) =>
		Effect.gen(function* () {
			const config = yield* ConfigService;
			yield* config.exportConfig(path);
			console.log(`Configuration exported to ${path}.`);
		}).pipe(
			Effect.catchTag('ConfigError', (e) =>
				Effect.sync(() => {
					console.error(`Error: ${e.message}`);
					process.exit(1);
				})
			),
			Effect.provide(programLayer)
		)
);

// config import - import config from file
const configImportPathOption = Options.text('path').pipe(Options.withAlias('p'));

const configImportCommand = Command.make(
	'import',
	{ path: configImportPathOption },
	({ path }) =>
		Effect.gen(function* () {
			const config = yield* ConfigService;
			yield* config.importConfig(path);
			console.log(`Configuration imported from ${path}.`);
		}).pipe(
			Effect.catchTag('ConfigError', (e) =>
				Effect.sync(() => {
					console.error(`Error: ${e.message}`);
					process.exit(1);
				})
			),
			Effect.provide(programLayer)
		)
);

// config - parent command
const configCommand = Command.make('config', {}, () =>
	Effect.gen(function* () {
		const config = yield* ConfigService;
		const configPath = yield* config.getConfigPath();

		console.log(`Config file: ${configPath}`);
		console.log('');
		console.log('Usage: btca config <command>');
		console.log('');
		console.log('Commands:');
		console.log('  model   View or set the model and provider');
		console.log('  repos   Manage configured repos');
		console.log('  export  Export configuration to a file');
		console.log('  import  Import configuration from a file');
		console.log('  reset   Reset configuration to defaults');
	}).pipe(Effect.provide(programLayer))
).pipe(
	Command.withSubcommands([
		configModelCommand,
		configReposCommand,
		configResetCommand,
		configExportCommand,
		configImportCommand
	])
);

// === Clean Subcommand ===
const cleanTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to clean local repository caches.
 */
const cleanCommand = Command.make('clean', { tech: cleanTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		const config = yield* ConfigService;

		if (tech._tag === 'Some') {
			yield* Effect.logDebug(`Command: clean, tech: ${tech.value}`);
			yield* config.cleanRepo(tech.value);
		} else {
			yield* Effect.logDebug(`Command: clean all`);
			yield* config.cleanAllRepos();
		}
	}).pipe(
		Effect.catchTag('ConfigError', (e) =>
			Effect.sync(() => {
				console.error(`Error: ${e.message}`);
				process.exit(1);
			})
		),
		Effect.provide(programLayer)
	)
);

// === Update Subcommand ===
const updateCommand = Command.make('update', {}, () =>
	Effect.gen(function* () {
		const config = yield* ConfigService;
		yield* config.updateAllRepos();
		console.log('All repositories updated.');
	}).pipe(Effect.provide(programLayer))
);

// === Doctor Command ===
const doctorCommand = Command.make('doctor', {}, () =>
	Effect.gen(function* () {
		console.log('Running health checks...\n');

		// 1. Bun Version
		try {
			const bunVersion = Bun.version;
			console.log(`[OK] Bun version: ${bunVersion}`);
		} catch (e) {
			console.log(`[FAIL] Bun version check failed: ${e}`);
		}

		// 2. Git Version
		try {
			const proc = Bun.spawn(['git', '--version']);
			const output = yield* Effect.tryPromise(() => new Response(proc.stdout).text());
			console.log(`[OK] Git found: ${output.trim()}`);
		} catch (e) {
			console.log(`[FAIL] Git check failed: ${e}`);
		}

		// 3. Git Config
		try {
			const procName = Bun.spawn(['git', 'config', 'user.name']);
			const nameOutput = yield* Effect.tryPromise(() => new Response(procName.stdout).text());
			if (nameOutput.trim()) {
				console.log(`[OK] Git user.name configured: ${nameOutput.trim()}`);
			} else {
				console.log('[WARN] Git user.name is NOT configured. Git operations might fail.');
			}

			const procEmail = Bun.spawn(['git', 'config', 'user.email']);
			const emailOutput = yield* Effect.tryPromise(() => new Response(procEmail.stdout).text());
			if (emailOutput.trim()) {
				console.log(`[OK] Git user.email configured: ${emailOutput.trim()}`);
			} else {
				console.log('[WARN] Git user.email is NOT configured. Git operations might fail.');
			}
		} catch (e) {
			console.log(`[FAIL] Git config check failed: ${e}`);
		}

		// 4. OpenCode Check
		try {
			const proc = Bun.spawn(['which', 'opencode']);
			yield* Effect.tryPromise(() => proc.exited);
			if (proc.exitCode === 0) {
				const output = yield* Effect.tryPromise(() => new Response(proc.stdout).text());
				console.log(`[OK] opencode found at: ${output.trim()}`);
			} else {
				console.log('[FAIL] opencode NOT found in PATH. Install it globally.');
			}
		} catch (e) {
			console.log(`[FAIL] opencode check failed: ${e}`);
		}

		// 5. Config & Permissions
		const config = yield* ConfigService;
		try {
			const configPath = yield* config.getConfigPath();
			yield* config.rawConfig();
			console.log(`[OK] Config file loaded: ${configPath}`);

			// Check write permissions
			const dir = configPath.substring(0, configPath.lastIndexOf('/'));
			// Using 'test -w' to check writability
			const testProc = Bun.spawn(['test', '-w', dir]);
			yield* Effect.tryPromise(() => testProc.exited);
			if (testProc.exitCode === 0) {
				console.log(`[OK] Config directory is writable: ${dir}`);
			} else {
				console.log(`[FAIL] Config directory is NOT writable: ${dir}`);
			}
		} catch (e) {
			console.log(`[FAIL] Config check failed: ${e}`);
		}
	}).pipe(Effect.provide(programLayer))
);

// === Browse Subcommand ===
const browseTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to open the local repository directory in the file explorer.
 */
const browseCommand = Command.make('browse', { tech: browseTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		const selectedTech = yield* selectRepo(tech);
		yield* Effect.logDebug(`Command: browse, tech: ${selectedTech}`);
		const config = yield* ConfigService;
		const repoPath = yield* config.getRepoPath(selectedTech);

		yield* Effect.logInfo(`Opening ${selectedTech} at ${repoPath}...`);

		// Determine command based on platform
		let command: string[];
		if (process.platform === 'darwin') {
			command = ['open', repoPath];
		} else if (process.platform === 'win32') {
			command = ['explorer', repoPath];
		} else {
			// Linux and others
			command = ['xdg-open', repoPath];
		}

		const proc = Bun.spawn(command, {
			stderr: 'ignore',
			stdout: 'ignore',
			stdin: 'ignore'
		});

		proc.unref();
	}).pipe(
		Effect.catchTag('ConfigError', (e) =>
			Effect.sync(() => {
				console.error(`Error: ${e.message}`);
				process.exit(1);
			})
		),
		Effect.provide(programLayer)
	)
);

// === Search Subcommand ===
const searchTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);
const searchQueryOption = Options.text('query').pipe(Options.withAlias('q'));

/**
 * Command to search for code in the local repository.
 */
const searchCommand = Command.make(
	'search',
	{ tech: searchTechOption, query: searchQueryOption },
	({ tech, query }) =>
		Effect.gen(function* () {
			const selectedTech = yield* selectRepo(tech);
			yield* Effect.logDebug(`Command: search, tech: ${selectedTech}, query: ${query}`);
			const config = yield* ConfigService;
			const repoPath = yield* config.getRepoPath(selectedTech);

			yield* Effect.logInfo(`Searching in ${selectedTech} at ${repoPath}...`);

			// Use grep to search recursively
			// -r: recursive
			// -n: line number
			// -C 2: context of 2 lines
			// -I: ignore binary files
			// --color=always: force color output
			const proc = Bun.spawn(
				['grep', '-r', '-n', '-C', '2', '-I', '--color=always', query, '.'],
				{
					cwd: repoPath,
					stdout: 'pipe',
					stderr: 'pipe'
				}
			);

			const output = yield* Effect.tryPromise(() => new Response(proc.stdout).text());
			const error = yield* Effect.tryPromise(() => new Response(proc.stderr).text());

			yield* Effect.tryPromise(() => proc.exited);

			if (proc.exitCode !== 0 && proc.exitCode !== 1) {
				// grep returns 1 if no matches found
				console.error(`Search failed: ${error}`);
				return;
			}

			if (!output.trim()) {
				console.log('No matches found.');
				return;
			}

			console.log(output);
		}).pipe(
			Effect.catchTag('ConfigError', (e) =>
				Effect.sync(() => {
					console.error(`Error: ${e.message}`);
					process.exit(1);
				})
			),
			Effect.provide(programLayer)
		)
);

// === Info Subcommand ===
const infoTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to show information about a repository.
 */
const infoCommand = Command.make('info', { tech: infoTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		const selectedTech = yield* selectRepo(tech);
		yield* Effect.logDebug(`Command: info, tech: ${selectedTech}`);
		const config = yield* ConfigService;
		const repoPath = yield* config.getRepoPath(selectedTech);

		const repos = yield* config.getRepos();
		const repoConfig = repos.find((r) => r.name === selectedTech);

		console.log(`Repository: ${selectedTech}`);
		if (repoConfig) {
			console.log(`URL: ${repoConfig.url}`);
			console.log(`Branch: ${repoConfig.branch}`);
		}
		console.log(`Local Path: ${repoPath}`);

		yield* Effect.logDebug(`Fetching git info for ${selectedTech}...`);

		// Git Log
		const procLog = Bun.spawn(['git', 'log', '-1', '--format=%H%n%an%n%ad%n%s'], {
			cwd: repoPath,
			stdout: 'pipe',
			stderr: 'pipe'
		});

		const logOutput = yield* Effect.tryPromise(() => new Response(procLog.stdout).text());
		yield* Effect.tryPromise(() => procLog.exited);

		if (procLog.exitCode === 0) {
			const lines = logOutput.trim().split('\n');
			if (lines.length >= 4) {
				console.log(`Latest Commit: ${lines[0]}`);
				console.log(`Author: ${lines[1]}`);
				console.log(`Date: ${lines[2]}`);
				console.log(`Message: ${lines[3]}`);
			}
		} else {
			console.log('Git info unavailable.');
		}

		// File Count
		const procCount = Bun.spawn(['git', 'ls-files'], {
			cwd: repoPath,
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const countOutput = yield* Effect.tryPromise(() => new Response(procCount.stdout).text());
		yield* Effect.tryPromise(() => procCount.exited);

		if (procCount.exitCode === 0) {
			const count = countOutput.trim().split('\n').filter((l) => l).length;
			console.log(`File Count: ${count}`);
		}
	}).pipe(
		Effect.catchTag('ConfigError', (e) =>
			Effect.sync(() => {
				console.error(`Error: ${e.message}`);
				process.exit(1);
			})
		),
		Effect.provide(programLayer)
	)
);

// === Status Subcommand ===
const statusTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

const statusCommand = Command.make('status', { tech: statusTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		const config = yield* ConfigService;

		const printStatus = (name: string, status: any) => {
			console.log(`Repository: ${name}`);
			if (!status.exists) {
				console.log(`Status: Not found locally`);
				console.log(`Path: ${status.path}`);
				return;
			}

			if (status.dirty) {
				console.log(`Status: Dirty (Uncommitted changes)`);
			} else if (status.behind > 0) {
				console.log(`Status: Behind by ${status.behind} commits`);
			} else if (status.ahead > 0) {
				console.log(`Status: Ahead by ${status.ahead} commits`);
			} else {
				console.log(`Status: Up to date`);
			}

			if (status.behind > 0 && status.ahead > 0) {
				console.log(`(Diverged: ${status.ahead} ahead, ${status.behind} behind)`);
			}

			console.log(`Path: ${status.path}`);
		};

		const printStatusRow = (name: string, status: any) => {
			let statusText = 'Up to date';
			let details = '';

			if (!status.exists) {
				statusText = 'Missing';
			} else if (status.dirty) {
				statusText = 'Dirty';
			} else if (status.behind > 0 && status.ahead > 0) {
				statusText = 'Diverged';
				details = `${status.ahead} ahead, ${status.behind} behind`;
			} else if (status.behind > 0) {
				statusText = 'Behind';
				details = `${status.behind} commits`;
			} else if (status.ahead > 0) {
				statusText = 'Ahead';
				details = `${status.ahead} commits`;
			}

			console.log(`${name.padEnd(20)} ${statusText.padEnd(15)} ${details}`);
		};

		if (tech._tag === 'Some') {
			yield* Effect.logDebug(`Command: status, tech: ${tech.value}`);
			const status = yield* config.getRepoStatus(tech.value);
			printStatus(tech.value, status);
		} else {
			yield* Effect.logDebug(`Command: status all`);
			const repos = yield* config.getRepos();
			if (repos.length === 0) {
				console.log('No repositories configured.');
				return;
			}
			console.log('Repository Status:\n');
			console.log(`${'Name'.padEnd(20)} ${'Status'.padEnd(15)} ${'Details'}`);
			console.log('-'.repeat(60));

			for (const repo of repos) {
				const status = yield* config.getRepoStatus(repo.name);
				printStatusRow(repo.name, status);
			}
		}
	}).pipe(
		Effect.catchTag('ConfigError', (e) =>
			Effect.sync(() => {
				console.error(`Error: ${e.message}`);
				process.exit(1);
			})
		),
		Effect.provide(programLayer)
	)
);

// === Code Subcommand ===
const codeTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to open the repository in a code editor.
 */
const codeCommand = Command.make('code', { tech: codeTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		const selectedTech = yield* selectRepo(tech);
		yield* Effect.logDebug(`Command: code, tech: ${selectedTech}`);
		const config = yield* ConfigService;
		const repoPath = yield* config.getRepoPath(selectedTech);

		// Determine editor command
		const editor = process.env.VISUAL || process.env.EDITOR || 'code';

		yield* Effect.logInfo(`Opening ${selectedTech} at ${repoPath} in ${editor}...`);

		const proc = Bun.spawn([editor, repoPath], {
			stderr: 'ignore',
			stdout: 'ignore',
			stdin: 'ignore'
		});

		proc.unref();
	}).pipe(
		Effect.catchTag('ConfigError', (e) =>
			Effect.sync(() => {
				console.error(`Error: ${e.message}`);
				process.exit(1);
			})
		),
		Effect.provide(programLayer)
	)
);

// === Stats Subcommand ===
const statsTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to show statistics about the repository.
 */
const statsCommand = Command.make('stats', { tech: statsTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		const selectedTech = yield* selectRepo(tech);
		yield* Effect.logDebug(`Command: stats, tech: ${selectedTech}`);
		const config = yield* ConfigService;
		const repoPath = yield* config.getRepoPath(selectedTech);

		yield* Effect.logInfo(`Gathering stats for ${selectedTech} at ${repoPath}...`);

		// Run in parallel
		const [langBreakdown, totalLines, contributors] = yield* Effect.all(
			[
				getLanguageBreakdown(repoPath),
				getTotalLines(repoPath),
				getTopContributors(repoPath)
			],
			{ concurrency: 3 }
		);

		console.log(`\nRepository Statistics: ${selectedTech}\n`);
		console.log(`Total Files: ${langBreakdown.totalFiles}`);
		console.log(`Total Lines of Code: ${totalLines}`);
		console.log('\nTop Contributors:');
		contributors.forEach((c) => console.log(`  ${c.name}: ${c.commits} commits`));
		console.log('\nLanguage Breakdown:');
		const sortedExtensions = Object.entries(langBreakdown.extensions).sort(
			(a, b) => b[1] - a[1]
		);
		sortedExtensions.forEach(([ext, count]) =>
			console.log(`  .${ext}: ${count} files`)
		);
		console.log('');
	}).pipe(
		Effect.catchTag('ConfigError', (e) =>
			Effect.sync(() => {
				console.error(`Error: ${e.message}`);
				process.exit(1);
			})
		),
		Effect.provide(programLayer)
	)
);

// === Bookmark Subcommands ===

const bookmarkListCommand = Command.make('list', {}, () =>
	Effect.gen(function* () {
		const bookmarkService = yield* BookmarkService;
		const bookmarks = yield* bookmarkService.getBookmarks();

		if (bookmarks.length === 0) {
			console.log('No bookmarks found.');
			return;
		}

		console.log('Bookmarks:\n');
		for (const b of bookmarks) {
			const date = new Date(b.timestamp).toLocaleString();
			console.log(`[${b.id.substring(0, 8)}] ${date} - ${b.tech}`);
			console.log(`Q: ${b.question}`);
			if (b.note) console.log(`Note: ${b.note}`);
			console.log('');
		}
	}).pipe(Effect.provide(programLayer))
);

const bookmarkQuestionOption = Options.text('question').pipe(Options.withAlias('q'), Options.optional);
const bookmarkAnswerOption = Options.text('answer').pipe(Options.withAlias('a'), Options.optional);
const bookmarkTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);
const bookmarkNoteOption = Options.text('note').pipe(Options.withAlias('n'), Options.optional);

const bookmarkAddCommand = Command.make(
	'add',
	{
		question: bookmarkQuestionOption,
		answer: bookmarkAnswerOption,
		tech: bookmarkTechOption,
		note: bookmarkNoteOption
	},
	({ question, answer, tech, note }) =>
		Effect.gen(function* () {
			const bookmarkService = yield* BookmarkService;
			const historyService = yield* HistoryService;

			// Manual mode
			if (question._tag === 'Some' && answer._tag === 'Some' && tech._tag === 'Some') {
				yield* bookmarkService.addBookmark({
					question: question.value,
					answer: answer.value,
					tech: tech.value,
					note: note._tag === 'Some' ? note.value : undefined
				});
				console.log('Bookmark added manually.');
				return;
			}

			// If missing some flags but present others
			if (question._tag === 'Some' || answer._tag === 'Some' || tech._tag === 'Some') {
				console.error(
					'Error: To add manually, you must provide --question, --answer, and --tech.'
				);
				process.exit(1);
			}

			// Interactive mode (from history)
			const entries = yield* historyService.getEntries(10);
			if (entries.length === 0) {
				console.log('No recent history to bookmark.');
				return;
			}

			const optionsMap = new Map<string, any>();
			const selectionOptions: string[] = [];

			entries.forEach((e) => {
				const date = new Date(e.timestamp).toLocaleDateString();
				const qShort = e.question.replace(/\n/g, ' ').substring(0, 40);
				const str = `${date} - ${e.tech}: ${qShort}`;
				optionsMap.set(str, e);
				selectionOptions.push(str);
			});

			try {
				const selection = yield* promptSelection(
					'Select history item to bookmark: ',
					selectionOptions
				);
				const entry = optionsMap.get(selection);

				if (entry) {
					yield* bookmarkService.addBookmark({
						question: entry.question,
						answer: entry.answer,
						tech: entry.tech,
						note: note._tag === 'Some' ? note.value : undefined
					});
					console.log('Bookmark added from history.');
				}
			} catch (e) {
				console.log('Operation cancelled.');
			}
		}).pipe(Effect.provide(programLayer))
);

const bookmarkRemoveCommand = Command.make('remove', {}, () =>
	Effect.gen(function* () {
		const bookmarkService = yield* BookmarkService;
		const bookmarks = yield* bookmarkService.getBookmarks();

		if (bookmarks.length === 0) {
			console.log('No bookmarks to remove.');
			return;
		}

		const optionsMap = new Map<string, string>();
		const selectionOptions: string[] = [];

		bookmarks.forEach((b) => {
			const date = new Date(b.timestamp).toLocaleDateString();
			const str = `[${b.id.substring(0, 6)}] ${date} - ${b.tech}: ${b.question.substring(0, 40)}`;
			optionsMap.set(str, b.id);
			selectionOptions.push(str);
		});

		try {
			const selection = yield* promptSelection('Select bookmark to remove: ', selectionOptions);
			const id = optionsMap.get(selection);

			if (id) {
				yield* bookmarkService.removeBookmark(id);
				console.log('Bookmark removed.');
			} else {
				console.log('Invalid selection.');
			}
		} catch (e) {
			// promptSelection fails if invalid selection
			console.log('Operation cancelled.');
		}
	}).pipe(Effect.provide(programLayer))
);

const bookmarkCommand = Command.make('bookmark', {}, () =>
	Effect.sync(() => {
		console.log('Usage: btca bookmark <command>');
		console.log('');
		console.log('Commands:');
		console.log('  list    List all bookmarks');
		console.log('  add     Add a new bookmark');
		console.log('  remove  Remove a bookmark');
	})
).pipe(Command.withSubcommands([bookmarkListCommand, bookmarkAddCommand, bookmarkRemoveCommand]));

// === Explain Subcommand ===
const explainFileOption = Options.text('file').pipe(Options.withAlias('f'));
const explainTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to explain the code in a specific file.
 */
const explainCommand = Command.make(
	'explain',
	{ file: explainFileOption, tech: explainTechOption },
	({ file, tech }) =>
		Effect.gen(function* () {
			const selectedTech = yield* selectRepo(tech);
			yield* Effect.logDebug(`Command: explain, tech: ${selectedTech}, file: ${file}`);
			const config = yield* ConfigService;

			let repoPath: string;
			if (selectedTech === 'local') {
				repoPath = process.cwd();
			} else {
				repoPath = yield* config.getRepoPath(selectedTech);
			}

			const absolutePath = path.resolve(repoPath, file);
			yield* Effect.logDebug(`Reading file: ${absolutePath}`);

			let content: string;
			const readResult = yield* Effect.tryPromise(() => fs.readFile(absolutePath, 'utf-8')).pipe(
				Effect.exit
			);

			if (readResult._tag === 'Failure') {
				console.error(`Error: File not found or unreadable: ${absolutePath}`);
				return;
			}
			content = readResult.value;

			const question = `Explain the code in ${file}:\n\n\`\`\`\n${content}\n\`\`\``;

			const oc = yield* OcService;
			const history = yield* HistoryService;

			const eventStream = yield* oc.askQuestion({ tech: selectedTech, question });

			yield* handleAnswerStream({
				eventStream,
				history,
				tech: selectedTech,
				question
			});
		}).pipe(
			Effect.catchTags({
				ConfigError: (e) =>
					Effect.sync(() => {
						console.error(`Error: ${e.message}`);
						process.exit(1);
					}),
				InvalidProviderError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Unknown provider "${e.providerId}"`);
						console.error(`Available providers: ${e.availableProviders.join(', ')}`);
						process.exit(1);
					}),
				InvalidModelError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Unknown model "${e.modelId}" for provider "${e.providerId}"`);
						console.error(`Available models: ${e.availableModels.join(', ')}`);
						process.exit(1);
					}),
				ProviderNotConnectedError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Provider "${e.providerId}" is not connected`);
						console.error(`Connected providers: ${e.connectedProviders.join(', ')}`);
						console.error(`Run "opencode auth" to configure provider credentials.`);
						process.exit(1);
					}),
				OcError: (e) =>
					Effect.sync(() => {
						console.error(`Error: ${e.message}`);
						if (e.cause) console.error(e.cause);
						process.exit(1);
					})
			}),
			Effect.provide(programLayer)
		)
);

// === Summary Subcommand ===
const summaryTechOption = Options.text('tech').pipe(Options.withAlias('t'), Options.optional);

/**
 * Command to generate a summary of the repository.
 */
const summaryCommand = Command.make(
	'summary',
	{ tech: summaryTechOption },
	({ tech }) =>
		Effect.gen(function* () {
			const selectedTech = yield* selectRepo(tech);
			yield* Effect.logDebug(`Command: summary, tech: ${selectedTech}`);
			const oc = yield* OcService;
			const history = yield* HistoryService;

			const question = `Please provide a comprehensive summary of this repository. Include:
1. The main purpose of the project.
2. The key technologies used.
3. The high-level architecture or directory structure.
4. Key features or capabilities.
Keep it concise but informative.`;

			const eventStream = yield* oc.askQuestion({ tech: selectedTech, question });

			yield* handleAnswerStream({
				eventStream,
				history,
				tech: selectedTech,
				question
			});
		}).pipe(
			Effect.catchTags({
				ConfigError: (e) =>
					Effect.sync(() => {
						console.error(`Error: ${e.message}`);
						process.exit(1);
					}),
				InvalidProviderError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Unknown provider "${e.providerId}"`);
						console.error(`Available providers: ${e.availableProviders.join(', ')}`);
						process.exit(1);
					}),
				InvalidModelError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Unknown model "${e.modelId}" for provider "${e.providerId}"`);
						console.error(`Available models: ${e.availableModels.join(', ')}`);
						process.exit(1);
					}),
				ProviderNotConnectedError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Provider "${e.providerId}" is not connected`);
						console.error(`Connected providers: ${e.connectedProviders.join(', ')}`);
						console.error(`Run "opencode auth" to configure provider credentials.`);
						process.exit(1);
					}),
				OcError: (e) =>
					Effect.sync(() => {
						console.error(`Error: ${e.message}`);
						if (e.cause) console.error(e.cause);
						process.exit(1);
					})
			}),
			Effect.provide(programLayer)
		)
);

// === Main Command ===
const mainCommand = Command.make('btca', {}, () =>
	Effect.sync(() => {
		console.log(`btca v${VERSION}. run btca --help for more information.`);
	})
).pipe(
	Command.withSubcommands([
		askCommand,
		explainCommand,
		summaryCommand,
		serveCommand,
		openCommand,
		chatCommand,
		browseCommand,
		webCommand,
		searchCommand,
		infoCommand,
		configCommand,
		historyCommand,
		doctorCommand,
		updateCommand,
		cleanCommand,
		statusCommand,
		codeCommand,
		statsCommand,
		bookmarkCommand
	])
);

const cliService = Effect.gen(function* () {
	return {
		/**
		 * Runs the CLI application with the given arguments.
		 */
		run: (argv: string[]) =>
			Command.run(mainCommand, {
				name: 'btca',
				version: VERSION
			})(argv)
	};
});

export class CliService extends Effect.Service<CliService>()('CliService', {
	effect: cliService
}) {}

export { type OcEvent };
