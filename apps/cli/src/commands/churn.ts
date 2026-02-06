import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { ConfigService } from "../services/config.ts";
import { selectRepo } from "../lib/ui.ts";
import { getChurn } from "../lib/git-stats.ts";

const churnTechOption = Options.text("tech").pipe(
  Options.withAlias("t"),
  Options.optional
);

const churnLimitOption = Options.integer("limit").pipe(
  Options.withAlias("n"),
  Options.withDefault(10)
);

export const churnCommand = Command.make(
  "churn",
  { tech: churnTechOption, limit: churnLimitOption },
  ({ tech, limit }) =>
    Effect.gen(function* () {
      const selectedTech = yield* selectRepo(tech);
      yield* Effect.logDebug(
        `Command: churn, tech: ${selectedTech}, limit: ${limit}`
      );
      const config = yield* ConfigService;
      const repoPath = yield* config.getRepoPath(selectedTech);

      const churn = yield* getChurn(repoPath, limit);

      console.log(`\nHigh Churn Files: ${selectedTech} (Top ${limit})\n`);
      if (churn.length === 0) {
        console.log("No churn data found.");
      } else {
        churn.forEach((item) => {
          console.log(`${item.count.toString().padStart(4)} ${item.file}`);
        });
      }
      console.log("");
    }).pipe(
      Effect.catchTag("ConfigError", (e) =>
        Effect.sync(() => {
          console.error(`Error: ${e.message}`);
          process.exit(1);
        })
      ),
      Effect.provide(ConfigService.Default)
    )
);
