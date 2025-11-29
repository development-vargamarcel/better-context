import type { Config } from "@opencode-ai/sdk";
import { Effect } from "effect";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import {
  PROMPTS_DIRECTORY,
  REPOS_DIRECTORY,
  DOCS_PROMPT_FILENAME,
} from "../lib/temp-constants.ts";
import { defaultRepos } from "../lib/defaults.ts";
import { getDocsAgentPrompt } from "../lib/prompts.ts";
import type { Repo } from "../lib/types.ts";
import { ConfigError } from "../lib/errors.ts";
import { cloneRepo, pullRepo } from "../lib/utils/git.ts";
import { directoryExists, expandHome } from "../lib/utils/files.ts";

// NOTE: this is a service because it's also gonna contain user config stuff for better context (where the config file lives, where the repos are cloned to, etc.)

const configService = Effect.gen(function* () {
  const promptsDir = expandHome(PROMPTS_DIRECTORY);
  const reposDir = expandHome(REPOS_DIRECTORY);
  const promptPath = path.join(promptsDir, DOCS_PROMPT_FILENAME);

  const ensureDocsAgentPrompt = (args: { repos: Repo[] }) =>
    Effect.gen(function* () {
      const { repos } = args;

      yield* Effect.tryPromise({
        try: () => mkdir(promptsDir, { recursive: true }),
        catch: (error) =>
          new ConfigError({
            message: "Failed to create prompts directory",
            cause: error,
          }),
      });

      const promptContent = getDocsAgentPrompt({
        repos: Object.values(repos),
        reposDirectory: reposDir,
      });

      yield* Effect.tryPromise({
        try: () => Bun.write(promptPath, promptContent),
        catch: (error) =>
          new ConfigError({
            message: "Failed to write docs agent prompt",
            cause: error,
          }),
      });

      yield* Effect.log(`Wrote docs agent prompt at ${promptPath}`);
    });

  const getRepo = (repoName: string) =>
    Effect.gen(function* () {
      if (Object.keys(defaultRepos).includes(repoName)) {
        return defaultRepos[repoName as keyof typeof defaultRepos];
      }
      return yield* Effect.fail(new ConfigError({ message: "Repo not found" }));
    });

  return {
    cloneOrUpdateOneRepoLocally: (repoName: string) =>
      Effect.gen(function* () {
        const repo = yield* getRepo(repoName);
        const repoDir = path.join(reposDir, repo.name);
        const branch = repo.branch ?? "main";

        const exists = yield* directoryExists(repoDir);
        if (exists) {
          yield* Effect.log(`Pulling latest changes for ${repo.name}...`);
          yield* pullRepo({ repoDir, branch });
        } else {
          yield* Effect.log(`Cloning ${repo.name}...`);
          yield* cloneRepo({ repoDir, url: repo.url, branch });
        }
        yield* Effect.log(`Done with ${repo.name}`);
        return repo;
      }),
    loadDocsAgentPrompt: (args: { repos: Repo[] }) =>
      Effect.gen(function* () {
        const { repos } = args;
        yield* ensureDocsAgentPrompt({ repos });
      }),
    getOpenCodeConfig: () =>
      Effect.succeed({
        agent: {
          build: {
            disable: true,
          },
          general: {
            disable: true,
          },
          plan: {
            disable: true,
          },
          docs: {
            prompt: `{file:${promptPath}}`,
            disable: false,
            description:
              "Get answers about libraries and frameworks by searching their source code",
            permission: {
              webfetch: "allow",
              edit: "deny",
              bash: "allow",
              external_directory: "allow",
              doom_loop: "deny",
            },
            mode: "primary",
            tools: {
              write: false,
              bash: true,
              delete: false,
              read: true,
              grep: true,
              glob: true,
              list: true,
              path: false,
              todowrite: false,
              todoread: false,
              websearch: true,
            },
          },
        },
      } satisfies Config),
  };
});

export class ConfigService extends Effect.Service<ConfigService>()(
  "ConfigService",
  {
    effect: configService,
  }
) {}
