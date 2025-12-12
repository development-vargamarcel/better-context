import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Cause, Effect, Exit } from "effect";
import { CliService } from "./services/cli.ts";

Effect.gen(function* () {
  const cli = yield* CliService;
  yield* cli.run(process.argv);
}).pipe(
  Effect.provide(CliService.Default),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain({
    teardown: (exit) => {
      // Force exit: opencode SDK's server.close() sends SIGTERM but doesn't
      // wait for child process termination, keeping Node's event loop alive
      const code =
        Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause) ? 1 : 0;
      process.exit(code);
    },
  })
);
