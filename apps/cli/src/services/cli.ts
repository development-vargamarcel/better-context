import { Command, Options } from '@effect/cli';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { BunHttpServer } from '@effect/platform-bun';
import { Effect, Layer, Schema, Stream } from 'effect';
import { OcService, type OcEvent } from './oc.ts';
import { ConfigService } from './config.ts';
import { HistoryService } from './history.ts';
import { GeneralError } from '../lib/errors.ts';

declare const __VERSION__: string;
const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

const programLayer = Layer.mergeAll(OcService.Default, ConfigService.Default, HistoryService.Default);

// === Ask Subcommand ===
const questionOption = Options.text('question').pipe(Options.withAlias('q'));
const techOption = Options.text('tech').pipe(Options.withAlias('t'));

const askCommand = Command.make(
	'ask',
	{ question: questionOption, tech: techOption },
	({ question, tech }) =>
		Effect.gen(function* () {
			yield* Effect.logDebug(
				`Command: ask, tech: ${tech}, question: ${question}`
			);
			const oc = yield* OcService;
			const history = yield* HistoryService;
			const eventStream = yield* oc.askQuestion({ tech, question });

			let currentMessageId: string | null = null;
			let fullAnswer = '';

			yield* eventStream.pipe(
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

			if (fullAnswer.trim()) {
				yield* history.addEntry({ tech, question, answer: fullAnswer.trim() });
			}

			console.log('\n');
		}).pipe(
			Effect.catchTags({
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
const openCommand = Command.make('open', {}, () =>
	Effect.gen(function* () {
		yield* Effect.logDebug(`Command: open`);
		const oc = yield* OcService;
		yield* oc.holdOpenInstanceInBg();
	}).pipe(Effect.provide(programLayer))
);

// === Chat Subcommand ===
const chatTechOption = Options.text('tech').pipe(Options.withAlias('t'));

const chatCommand = Command.make('chat', { tech: chatTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		yield* Effect.logDebug(`Command: chat, tech: ${tech}`);
		const oc = yield* OcService;
		yield* oc.spawnTui({ tech });
	}).pipe(Effect.provide(programLayer))
);

// === Serve Subcommand ===
const QuestionRequest = Schema.Struct({
	tech: Schema.String,
	question: Schema.String
});

const portOption = Options.integer('port').pipe(Options.withAlias('p'), Options.withDefault(8080));

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
		console.log('  clear   Clear history');
		console.log('  export  Export history to a file');
	})
).pipe(
	Command.withSubcommands([
		historyListCommand,
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
	}).pipe(Effect.provide(programLayer))
).pipe(Command.withSubcommands([configModelCommand, configReposCommand]));

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

		// 3. Config & Permissions
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

// === Main Command ===
const mainCommand = Command.make('btca', {}, () =>
	Effect.sync(() => {
		console.log(`btca v${VERSION}. run btca --help for more information.`);
	})
).pipe(
	Command.withSubcommands([
		askCommand,
		serveCommand,
		openCommand,
		chatCommand,
		configCommand,
		historyCommand,
		doctorCommand
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
