import type { Config } from "@opencode-ai/sdk";
import { Effect } from "effect";
import { TaggedError } from "effect/Data";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import {
  CONFIG_DIRECTORY,
  PROMPTS_DIRECTORY,
  REPOS_DIRECTORY,
  DOCS_PROMPT_FILENAME,
  expandHome,
} from "../lib/utils.ts";

class ConfigError extends TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type Repo = {
  name: string;
  url: string;
  branch?: string;
};

const repos = {
  effect: {
    name: "effect",
    url: "https://github.com/Effect-TS/effect",
    branch: "main",
  },
  opencode: {
    name: "opencode",
    url: "https://github.com/sst/opencode",
    branch: "production",
  },
  svelte: {
    name: "svelte",
    url: "https://github.com/sveltejs/svelte.dev",
    branch: "main",
  },
  daytona: {
    name: "daytona",
    url: "https://github.com/daytonaio/daytona",
    branch: "main",
  },
  neverthrow: {
    name: "neverthrow",
    url: "https://github.com/supermacro/neverthrow",
    branch: "master",
  },
} satisfies Record<string, Repo>;

export type RepoName = keyof typeof repos;

export const DOCS_AGENT_PROMPT = (args: {
  repos: Repo[];
  reposDirectory: string;
}) => `
You are an expert internal agent who's job is to answer coding questions and provide accurate and up to date info on different technologies, libraries, frameworks, or tools you're using based on the library codebases you have access to.

Currently you have access to the following codebases:

${args.repos.map((repo) => `- ${repo.name}\n`)}

They are located at the following path:

${args.reposDirectory}

When asked a question regarding the codebase, search the codebase to get an accurate answer.

Always search the codebase first before using the web to try to answer the question.

When you are searching the codebase, be very careful that you do not read too much at once. Only read a small amount at a time as you're searching, avoid reading dozens of files at once...

When responding:

- If something about the question is not clear, ask the user to provide more information
- Really try to keep your responses concise, you don't need tons of examples, just one really good one
- Be extremely concise. Sacrifice grammar for the sake of concision.
- When outputting code snippets, include comments that explain what each piece does
- Always bias towards simple practical examples over complex theoretical explanations
- Give your response in markdown format, make sure to have spacing between code blocks and other content
`;

// NOTE: this is a service because it's also gonna contain user config stuff for better context (where the config file lives, where the repos are cloned to, etc.)

const configService = Effect.gen(function* () {
  const ensureDocsAgentPrompt = Effect.gen(function* () {
    const promptsDir = expandHome(PROMPTS_DIRECTORY);
    const reposDir = expandHome(REPOS_DIRECTORY);
    const promptPath = path.join(promptsDir, DOCS_PROMPT_FILENAME);

    const file = Bun.file(promptPath);
    const exists = yield* Effect.tryPromise({
      try: () => file.exists(),
      catch: (error) =>
        new ConfigError({
          message: "Failed to check prompt file",
          cause: error,
        }),
    });

    if (exists) {
      return;
    }

    yield* Effect.tryPromise({
      try: () => mkdir(promptsDir, { recursive: true }),
      catch: (error) =>
        new ConfigError({
          message: "Failed to create prompts directory",
          cause: error,
        }),
    });

    const promptContent = DOCS_AGENT_PROMPT({
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

    yield* Effect.log(`Created docs agent prompt at ${promptPath}`);
  });

  yield* ensureDocsAgentPrompt;

  return {
    getAllRepos: () => Effect.succeed(Object.values(repos)),
    getRepo: (repoName: RepoName) => Effect.succeed(repos[repoName]),
    getConfigDirectory: () => Effect.succeed(CONFIG_DIRECTORY),
    getPromptsDirectory: () => Effect.succeed(PROMPTS_DIRECTORY),
    getDocsAgentPromptPath: () =>
      Effect.succeed(
        path.join(expandHome(PROMPTS_DIRECTORY), DOCS_PROMPT_FILENAME)
      ),
    getOpenCodeConfig: (args: { agentPromptPath: string }) =>
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
            prompt: `{file:${args.agentPromptPath}}`,
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
