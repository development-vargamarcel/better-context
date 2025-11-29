import {
  createOpencode,
  type OpencodeClient,
  type Event,
} from "@opencode-ai/sdk";
import { Deferred, Effect, Stream } from "effect";
import { TaggedError } from "effect/Data";
import { ConfigService } from "./config.ts";

class OcError extends TaggedError("OcError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type { Event as OcEvent };

const ocService = Effect.gen(function* () {
  const config = yield* ConfigService;
  const agentPromptPath = yield* config.getDocsAgentPromptPath();
  const configObject = yield* config.getOpenCodeConfig({ agentPromptPath });

  const { client, server } = yield* Effect.tryPromise({
    try: () =>
      createOpencode({
        port: 3420,
        config: configObject,
      }),
    catch: (err) =>
      new OcError({ message: "FAILED TO CREATE OPENCODE CLIENT", cause: err }),
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      console.log("CLOSING OPENCODE SERVER");
      server.close();
    })
  );

  const streamSessionEvents = (args: { sessionID: string }) =>
    Effect.gen(function* () {
      const { sessionID } = args;

      const events = yield* Effect.tryPromise({
        try: () => client.event.subscribe(),
        catch: (err) =>
          new OcError({
            message: "Failed to subscribe to events",
            cause: err,
          }),
      });

      return Stream.fromAsyncIterable(
        events.stream,
        (e) => new OcError({ message: "Event stream error", cause: e })
      ).pipe(
        Stream.filter((event) => {
          const props = event.properties;
          if (!("sessionID" in props)) return true;
          return props.sessionID === sessionID;
        }),
        Stream.takeUntil(
          (event) =>
            event.type === "session.idle" &&
            event.properties.sessionID === sessionID
        )
      );
    });

  const firePrompt = (args: {
    sessionID: string;
    text: string;
    errorDeferred: Deferred.Deferred<never, OcError>;
  }) =>
    Effect.promise(() =>
      client.session.prompt({
        path: { id: args.sessionID },
        body: {
          agent: "docs",
          model: {
            providerID: "opencode",
            modelID: "claude-haiku-4-5",
          },
          parts: [{ type: "text", text: args.text }],
        },
      })
    ).pipe(
      Effect.catchAll((err) =>
        Deferred.fail(
          args.errorDeferred,
          new OcError({ message: String(err), cause: err })
        )
      )
    );

  const streamPrompt = (args: { sessionID: string; prompt: string }) =>
    Effect.gen(function* () {
      const { sessionID, prompt } = args;

      const eventStream = yield* streamSessionEvents({ sessionID });

      const errorDeferred = yield* Deferred.make<never, OcError>();

      yield* firePrompt({ sessionID, text: prompt, errorDeferred }).pipe(
        Effect.forkDaemon
      );

      // Transform stream to fail on session.error, race with prompt error
      return eventStream.pipe(
        Stream.mapEffect((event) =>
          Effect.gen(function* () {
            if (event.type === "session.error") {
              const props = event.properties as { error?: { name?: string } };
              return yield* Effect.fail(
                new OcError({
                  message: props.error?.name ?? "Unknown session error",
                  cause: props.error,
                })
              );
            }
            return event;
          })
        ),
        Stream.interruptWhen(Deferred.await(errorDeferred))
      );
    });

  return {
    testPrompting: (prompt: string) =>
      Effect.gen(function* () {
        const session = yield* Effect.promise(() => client.session.create());

        if (session.error) {
          return yield* Effect.fail(
            new OcError({
              message: "FAILED TO START OPENCODE SESSION",
              cause: session.error,
            })
          );
        }

        const sessionID = session.data.id;
        yield* Effect.log(`PROMPTING WITH: ${prompt}`);

        return yield* streamPrompt({ sessionID, prompt });
      }),
  };
});

export class OcService extends Effect.Service<OcService>()("OcService", {
  scoped: ocService,
  dependencies: [ConfigService.Default],
}) {}
