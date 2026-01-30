import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Cause, Effect, Exit, Logger, LogLevel } from "effect";
import { CliService } from "./services/cli.ts";

const logLevel = (() => {
  const env = process.env.EFFECT_LOG_LEVEL?.toLowerCase();
  switch (env) {
    case "debug":
      return LogLevel.Debug;
    case "info":
      return LogLevel.Info;
    case "warning":
      return LogLevel.Warning;
    case "error":
      return LogLevel.Error;
    case "none":
      return LogLevel.None;
    default:
      return LogLevel.Info;
  }
})();

Effect.gen(function* () {
  const cli = yield* CliService;
  yield* cli.run(process.argv);
}).pipe(
  Effect.provide(CliService.Default),
  Effect.provide(BunContext.layer),
  Logger.withMinimumLogLevel(logLevel),
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
