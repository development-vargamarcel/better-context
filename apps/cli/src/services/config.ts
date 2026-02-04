import type { Config as OpenCodeConfig } from "@opencode-ai/sdk";
import { FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";
import { getDocsAgentPrompt } from "../lib/prompts.ts";
import { ConfigError } from "../lib/errors.ts";
import {
  cloneRepo,
  pullRepo,
  validateRepo,
  fetchRepo,
  getRepoStatus,
} from "../lib/utils/git.ts";
import { directoryExists, expandHome } from "../lib/utils/files.ts";

const CONFIG_DIRECTORY = "~/.config/btca";
const CONFIG_FILENAME = "btca.json";

const repoSchema = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  branch: Schema.String,
  specialNotes: Schema.String.pipe(Schema.optional),
});

const configSchema = Schema.Struct({
  promptsDirectory: Schema.String,
  reposDirectory: Schema.String,
  port: Schema.Number,
  maxInstances: Schema.Number,
  repos: Schema.Array(repoSchema),
  model: Schema.String,
  provider: Schema.String,
});

type Config = typeof configSchema.Type;
type Repo = typeof repoSchema.Type;

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Config = {
  promptsDirectory: `${CONFIG_DIRECTORY}/prompts`,
  reposDirectory: `${CONFIG_DIRECTORY}/repos`,
  port: 3420,
  maxInstances: 5,
  repos: [
    {
      name: "svelte",
      url: "https://github.com/sveltejs/svelte.dev",
      branch: "main",
      specialNotes:
        "This is the svelte docs website repo, not the actual svelte repo. Use the docs to answer questions about svelte.",
    },
    {
      name: "tailwindcss",
      url: "https://github.com/tailwindlabs/tailwindcss.com",
      branch: "main",
      specialNotes:
        "This is the tailwindcss docs website repo, not the actual tailwindcss repo. Use the docs to answer questions about tailwindcss.",
    },
    {
      name: "nextjs",
      url: "https://github.com/vercel/next.js",
      branch: "canary",
    },
  ],
  model: "big-pickle",
  provider: "opencode",
};

/**
 * Collapses a path starting with the home directory to use tilde (~).
 */
const collapseHome = (path: string): string => {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (home && path.startsWith(home)) {
    return "~" + path.slice(home.length);
  }
  return path;
};

/**
 * Writes the configuration to disk.
 */
const writeConfig = (config: Config) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;

    const configDir = yield* expandHome(CONFIG_DIRECTORY);
    const configPath = path.join(configDir, CONFIG_FILENAME);

    // Collapse expanded paths back to tilde for storage
    const configToWrite: Config = {
      ...config,
      promptsDirectory: collapseHome(config.promptsDirectory),
      reposDirectory: collapseHome(config.reposDirectory),
    };

    yield* Effect.logDebug(`Writing config to ${configPath}`);
    yield* fs
      .writeFileString(configPath, JSON.stringify(configToWrite, null, 2))
      .pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            new ConfigError({
              message: "Failed to write config",
              cause: error,
            })
          )
        )
      );

    return configToWrite;
  });

const OPENCODE_CONFIG = (args: {
  repoName: string;
  reposDirectory: string;
  specialNotes?: string;
  /**
   * Optional absolute path to the repository.
   * If provided, it overrides the default path resolution (reposDirectory + repoName).
   */
  absoluteRepoPath?: string;
}): Effect.Effect<OpenCodeConfig, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const repoPath =
      args.absoluteRepoPath ?? path.join(args.reposDirectory, args.repoName);
    return {
      agent: {
        build: {
          disable: true,
        },
        explore: {
          disable: true,
        },
        general: {
          disable: true,
        },
        plan: {
          disable: true,
        },
        docs: {
          prompt: getDocsAgentPrompt({
            repoName: args.repoName,
            repoPath,
            specialNotes: args.specialNotes,
          }),
          disable: false,
          description:
            "Get answers about libraries and frameworks by searching their source code",
          permission: {
            webfetch: "deny",
            edit: "deny",
            bash: "deny",
            external_directory: "allow",
            doom_loop: "deny",
          },
          mode: "primary",
          tools: {
            write: false,
            bash: false,
            delete: false,
            read: true,
            grep: true,
            glob: true,
            list: true,
            path: false,
            todowrite: false,
            todoread: false,
            websearch: false,
          },
        },
      },
    };
  });

const onStartLoadConfig = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const configDir = yield* expandHome(CONFIG_DIRECTORY);
  const configPath = path.join(configDir, CONFIG_FILENAME);

  const exists = yield* fs.exists(configPath);

  if (!exists) {
    yield* Effect.log(
      `Config file not found at ${configPath}, creating default config...`
    );
    // Ensure directory exists
    yield* fs
      .makeDirectory(configDir, { recursive: true })
      .pipe(Effect.catchAll(() => Effect.void));
    yield* fs
      .writeFileString(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
      .pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            new ConfigError({
              message: "Failed to create default config",
              cause: error,
            })
          )
        )
      );
    yield* Effect.log(`Default config created at ${configPath}`);
    const promptsDir = yield* expandHome(DEFAULT_CONFIG.promptsDirectory);
    const reposDir = yield* expandHome(DEFAULT_CONFIG.reposDirectory);
    const config = {
      ...DEFAULT_CONFIG,
      promptsDirectory: promptsDir,
      reposDirectory: reposDir,
    } satisfies Config;
    return {
      config,
      configPath,
    };
  } else {
    yield* Effect.logDebug(`Loading config from ${configPath}`);
    const content = yield* fs.readFileString(configPath).pipe(
      Effect.catchAll((error) =>
        Effect.fail(
          new ConfigError({
            message: "Failed to load config",
            cause: error,
          })
        )
      )
    );
    const parsed = JSON.parse(content);
    return yield* Effect.succeed(parsed).pipe(
      Effect.flatMap(Schema.decode(configSchema)),
      Effect.flatMap((loadedConfig) =>
        Effect.gen(function* () {
          const promptsDir = yield* expandHome(loadedConfig.promptsDirectory);
          const reposDir = yield* expandHome(loadedConfig.reposDirectory);
          const config = {
            ...loadedConfig,
            promptsDirectory: promptsDir,
            reposDirectory: reposDir,
          } satisfies Config;
          return {
            config,
            configPath,
          };
        })
      )
    );
  }
});

const configService = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const loadedConfig = yield* onStartLoadConfig;

  let { config, configPath } = loadedConfig;

  /**
   * Helper to find a repo by name in the current config.
   */
  const getRepo = ({
    repoName,
    config,
  }: {
    repoName: string;
    config: Config;
  }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`Looking up repo: ${repoName}`);
      const repo = config.repos.find((repo) => repo.name === repoName);
      if (!repo) {
        return yield* Effect.fail(
          new ConfigError({
            message: `Repo "${repoName}" not found. Run "btca config repos list" to see available repos.`,
          })
        );
      }
      return repo;
    });

  const cloneOrUpdateOneRepoLocally = (repoName: string) =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`Request to clone/update repo: ${repoName}`);

      if (repoName === "local") {
        yield* Effect.logDebug("Skipping clone/update for local directory");
        return {
          name: "local",
          url: "local",
          branch: "local",
        };
      }

      const repo = yield* getRepo({ repoName, config });
      const repoDir = path.join(config.reposDirectory, repo.name);
      const branch = repo.branch ?? "main";

      const exists = yield* directoryExists(repoDir);
      if (exists) {
        yield* Effect.logInfo(`Pulling latest changes for ${repo.name}...`);
        yield* pullRepo({ repoDir, branch });
        yield* Effect.logDebug(`Successfully pulled ${repo.name}`);
      } else {
        yield* Effect.logInfo(`Cloning ${repo.name}...`);
        yield* cloneRepo({ repoDir, url: repo.url, branch });
        yield* Effect.logDebug(`Successfully cloned ${repo.name}`);
      }
      yield* Effect.logInfo(`Done with ${repo.name}`);
      return repo;
    });

  const cleanRepoInternal = (repoName: string) =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`Cleaning repo files: ${repoName}`);

      if (repoName === "local") {
        yield* Effect.logWarning("Cannot clean local directory. Skipping.");
        return;
      }

      const repo = config.repos.find((r) => r.name === repoName);
      if (!repo) {
        return yield* Effect.fail(
          new ConfigError({ message: `Repo "${repoName}" not found` })
        );
      }

      const repoDir = path.join(config.reposDirectory, repo.name);
      const exists = yield* directoryExists(repoDir);
      if (exists) {
        yield* Effect.log(`Removing directory ${repoDir}...`);
        yield* fs.remove(repoDir, { recursive: true }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new ConfigError({
                message: "Failed to remove directory",
                cause: error,
              })
            )
          )
        );
        yield* Effect.logInfo(`Cleaned files for repo "${repoName}"`);
      } else {
        yield* Effect.logInfo(`No files found for repo "${repoName}"`);
      }
    });

  return {
    /**
     * Returns the path to the current configuration file.
     */
    getConfigPath: () => Effect.succeed(configPath),
    /**
     * Clones or pulls the specified repository locally.
     * @param repoName The name of the repository to clone or update.
     */
    cloneOrUpdateOneRepoLocally,
    /**
     * Gets the local file system path for a repository, ensuring it is cloned and updated.
     * @param repoName The name of the repository.
     */
    getRepoPath: (repoName: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Getting path for repo: ${repoName}`);
        if (repoName === "local") {
          return process.cwd();
        }
        const repo = yield* cloneOrUpdateOneRepoLocally(repoName);
        return path.join(config.reposDirectory, repo.name);
      }),
    /**
     * Generates the OpenCode configuration for the specified repository.
     * @param args.repoName The name of the repository to generate config for.
     */
    getOpenCodeConfig: (args: { repoName: string }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `Generating OpenCode config for: ${args.repoName}`
        );

        if (args.repoName === "local") {
          return yield* OPENCODE_CONFIG({
            repoName: "local",
            reposDirectory: "",
            absoluteRepoPath: process.cwd(),
          });
        }

        const repo = yield* getRepo({ repoName: args.repoName, config }).pipe(
          Effect.catchTag("ConfigError", () => Effect.succeed(undefined))
        );
        return yield* OPENCODE_CONFIG({
          repoName: args.repoName,
          reposDirectory: config.reposDirectory,
          specialNotes: repo?.specialNotes,
        });
      }),
    /**
     * Returns the raw configuration object.
     */
    rawConfig: () =>
      Effect.logDebug("Retrieving raw config").pipe(Effect.as(config)),
    /**
     * Returns the list of configured repositories.
     */
    getRepos: () =>
      Effect.logDebug("Retrieving configured repos").pipe(
        Effect.as(config.repos)
      ),
    /**
     * Returns the current model and provider configuration.
     */
    getModel: () =>
      Effect.logDebug("Retrieving model configuration").pipe(
        Effect.as({ provider: config.provider, model: config.model })
      ),
    /**
     * Updates the AI model and provider configuration.
     * @param args.provider The provider ID.
     * @param args.model The model ID.
     */
    updateModel: (args: { provider: string; model: string }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `Updating model to ${args.provider}/${args.model}`
        );
        config = { ...config, provider: args.provider, model: args.model };
        yield* writeConfig(config);
        return { provider: config.provider, model: config.model };
      }),
    /**
     * Removes a repository from the configuration.
     * @param args.name The name of the repository to remove.
     * @param args.deleteFiles Whether to delete the repository files from disk.
     */
    removeRepo: (args: { name: string; deleteFiles: boolean }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Removing repo: ${args.name}`);
        const repo = config.repos.find((r) => r.name === args.name);
        if (!repo) {
          return yield* Effect.fail(
            new ConfigError({ message: `Repo "${args.name}" not found` })
          );
        }

        if (args.deleteFiles) {
          const repoDir = path.join(config.reposDirectory, repo.name);
          const exists = yield* directoryExists(repoDir);
          if (exists) {
            yield* Effect.log(`Removing directory ${repoDir}...`);
            yield* fs.remove(repoDir, { recursive: true }).pipe(
              Effect.catchAll((error) =>
                Effect.fail(
                  new ConfigError({
                    message: "Failed to remove directory",
                    cause: error,
                  })
                )
              )
            );
          }
        }

        config = {
          ...config,
          repos: config.repos.filter((r) => r.name !== args.name),
        };
        yield* writeConfig(config);
        yield* Effect.logInfo(`Repo "${args.name}" removed`);
        return repo;
      }),
    /**
     * Adds a new repository to the configuration.
     * @param repo The repository to add.
     */
    addRepo: (repo: Repo) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Adding repo: ${repo.name} (${repo.url})`);
        const existing = config.repos.find((r) => r.name === repo.name);
        if (existing) {
          return yield* Effect.fail(
            new ConfigError({ message: `Repo "${repo.name}" already exists` })
          );
        }

        // Validate the repo URL
        yield* Effect.logDebug(`Validating repo URL: ${repo.url}`);
        yield* validateRepo(repo.url);

        config = { ...config, repos: [...config.repos, repo] };
        yield* writeConfig(config);
        yield* Effect.logInfo(`Repo "${repo.name}" added`);
        return repo;
      }),
    /**
     * Resets the configuration to the default values.
     */
    resetConfig: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Resetting config to defaults...");

        const promptsDir = yield* expandHome(DEFAULT_CONFIG.promptsDirectory);
        const reposDir = yield* expandHome(DEFAULT_CONFIG.reposDirectory);

        config = {
          ...DEFAULT_CONFIG,
          promptsDirectory: promptsDir,
          reposDirectory: reposDir,
        };

        yield* writeConfig(config);
        yield* Effect.logInfo("Configuration reset to defaults.");
        return config;
      }),
    /**
     * Updates all configured repositories.
     */
    updateAllRepos: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Updating all configured repositories...");
        const repos = config.repos;
        if (repos.length === 0) {
          yield* Effect.logInfo("No repositories configured.");
          return;
        }

        for (const repo of repos) {
          yield* cloneOrUpdateOneRepoLocally(repo.name);
        }
      }),
    /**
     * Exports the current configuration to a file.
     * @param outputPath The path to export the configuration to.
     */
    exportConfig: (outputPath: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Exporting config to ${outputPath}`);
        const fs = yield* FileSystem.FileSystem;

        // Collapse expanded paths back to tilde for storage
        const configToWrite: Config = {
          ...config,
          promptsDirectory: collapseHome(config.promptsDirectory),
          reposDirectory: collapseHome(config.reposDirectory),
        };

        yield* fs
          .writeFileString(outputPath, JSON.stringify(configToWrite, null, 2))
          .pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new ConfigError({
                  message: "Failed to export config",
                  cause: error,
                })
              )
            )
          );
        yield* Effect.logInfo(`Configuration exported to ${outputPath}`);
      }),

    /**
     * Imports a configuration from a file.
     * @param inputPath The path to import the configuration from.
     */
    importConfig: (inputPath: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Importing config from ${inputPath}`);
        const fs = yield* FileSystem.FileSystem;

        const exists = yield* fs.exists(inputPath);
        if (!exists) {
          return yield* Effect.fail(
            new ConfigError({ message: `Import file "${inputPath}" not found` })
          );
        }

        const content = yield* fs.readFileString(inputPath).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new ConfigError({
                message: "Failed to read import file",
                cause: error,
              })
            )
          )
        );

        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          return yield* Effect.fail(
            new ConfigError({ message: "Import file is not valid JSON" })
          );
        }

        const importedConfig = yield* Schema.decodeUnknown(configSchema)(
          parsed
        ).pipe(
          Effect.catchAll((e) =>
            Effect.fail(
              new ConfigError({
                message: "Import file does not match config schema",
                cause: e,
              })
            )
          )
        );

        // Update current config
        // We need to expand home paths for the runtime config
        const promptsDir = yield* expandHome(importedConfig.promptsDirectory);
        const reposDir = yield* expandHome(importedConfig.reposDirectory);

        config = {
          ...importedConfig,
          promptsDirectory: promptsDir,
          reposDirectory: reposDir,
        };

        // Write to default config file
        yield* writeConfig(config);
        yield* Effect.logInfo(`Configuration imported from ${inputPath}`);
      }),

    /**
     * Cleans the local files for a repository (without removing it from config).
     * @param repoName The name of the repository to clean.
     */
    cleanRepo: cleanRepoInternal,
    /**
     * Cleans all local repository files.
     */
    cleanAllRepos: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Cleaning all repository files...");
        const repos = config.repos;
        if (repos.length === 0) {
          yield* Effect.logInfo("No repositories configured.");
          return;
        }

        for (const repo of repos) {
          yield* cleanRepoInternal(repo.name);
        }
        yield* Effect.logInfo("All repositories cleaned.");
      }),
    /**
     * Gets the status of a repository (ahead/behind/dirty).
     * @param repoName The name of the repository.
     */
    getRepoStatus: (repoName: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Getting status for repo: ${repoName}`);

        if (repoName === "local") {
          return {
            exists: true,
            dirty: false,
            ahead: 0,
            behind: 0,
            path: process.cwd(),
          };
        }

        const repo = config.repos.find((r) => r.name === repoName);
        if (!repo) {
          return yield* Effect.fail(
            new ConfigError({ message: `Repo "${repoName}" not found` })
          );
        }

        const repoDir = path.join(config.reposDirectory, repo.name);
        const exists = yield* directoryExists(repoDir);

        if (!exists) {
          return {
            exists: false,
            dirty: false,
            ahead: 0,
            behind: 0,
            path: repoDir,
          };
        }

        // Fetch updates
        yield* fetchRepo({ repoDir });

        // Get status
        const status = yield* getRepoStatus({
          repoDir,
          branch: repo.branch ?? "main",
        });

        return {
          exists: true,
          path: repoDir,
          ...status,
        };
      }),
  };
});

export class ConfigService extends Effect.Service<ConfigService>()(
  "ConfigService",
  {
    effect: configService,
  }
) {}
