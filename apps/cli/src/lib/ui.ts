import * as readline from "node:readline";
import { Effect, Option, Console } from "effect";
import { ConfigService } from "../services/config.ts";
import { ConfigError } from "./errors.ts";

export const promptSelection = (question: string, options: string[]) =>
  Effect.gen(function* () {
    if (options.length === 0) {
      return yield* Effect.fail(new ConfigError({ message: "No options provided" }));
    }

    options.forEach((opt, index) => {
      console.log(`${index + 1}. ${opt}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = yield* Effect.promise(
      () =>
        new Promise<string>((resolve) => {
          rl.question(question, (ans) => {
            rl.close();
            resolve(ans);
          });
        })
    );

    const index = parseInt(answer) - 1;
    if (isNaN(index) || index < 0 || index >= options.length) {
      // If the user typed the name directly, try to match it
      const found = options.find(o => o === answer.trim());
      if (found) return found;

      return yield* Effect.fail(new ConfigError({ message: "Invalid selection" }));
    }

    return options[index] as string;
  });

export const selectRepo = (techOption: Option.Option<string>): Effect.Effect<string, ConfigError, ConfigService> =>
  Effect.gen(function* () {
    if (Option.isSome(techOption)) {
      return techOption.value;
    }

    const config = yield* ConfigService;
    const repos = yield* config.getRepos();

    if (repos.length === 0) {
      // Even if no repos are configured, we should allow 'local'
      // But maybe the user just wants to use local.
      // If no repos, we can just show local?
      // Let's stick to showing local + repos.
    }

    yield* Console.log("Please select a repository:");
    const repoNames = repos.map((r) => r.name);
    const localOption = "local (Current Directory)";

    const selection = yield* promptSelection("Enter number or name: ", [
      localOption,
      ...repoNames,
    ]);

    if (selection === localOption) {
      return "local";
    }

    return selection;
  });
