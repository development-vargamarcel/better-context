import {
  createOpencode,
  OpencodeClient,
  type Event,
  type Config as OpenCodeConfig,
} from "@opencode-ai/sdk";
import { spawn } from "bun";
import { Deferred, Duration, Effect, Stream } from "effect";
import { ConfigService } from "./config.ts";
import { OcError } from "../lib/errors.ts";
import { validateProviderAndModel } from "../lib/utils/validation.ts";

const spawnOpencodeTui = async (args: {
  config: OpenCodeConfig;
  rawConfig: { provider: string; model: string };
}) => {
  const proc = spawn(
    ["opencode", `--model=${args.rawConfig.provider}/${args.rawConfig.model}`],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(args.config),
      },
    }
  );

  await proc.exited;
};

export type { Event as OcEvent };

const ocService = Effect.gen(function* () {
  const config = yield* ConfigService;

  const rawConfig = yield* config.rawConfig();

  /**
   * Attempts to create an OpenCode instance, trying multiple ports if necessary.
   */
  const getOpencodeInstance = ({ tech }: { tech: string }) =>
    Effect.gen(function* () {
      let portOffset = 0;
      const maxInstances = 5;
      const configObject = yield* config.getOpenCodeConfig({ repoName: tech });

      while (portOffset < maxInstances) {
        const port = 3420 + portOffset;
        yield* Effect.logDebug(`Attempting to start OpenCode on port ${port}`);
        const result = yield* Effect.tryPromise(() =>
          createOpencode({
            port,
            config: configObject,
          })
        ).pipe(
          Effect.catchAll((err) => {
            if (
              err.cause instanceof Error &&
              err.cause.stack?.includes("port")
            ) {
              portOffset++;
              return Effect.logDebug(
                `Port ${port} in use, trying next...`
              ).pipe(Effect.as(null));
            }
            return Effect.fail(
              new OcError({
                message: "FAILED TO CREATE OPENCODE CLIENT",
                cause: err,
              })
            );
          })
        );
        if (result !== null) {
          return result;
        }
      }
      return yield* Effect.fail(
        new OcError({
          message: "FAILED TO CREATE OPENCODE CLIENT - all ports exhausted",
          cause: null,
        })
      );
    });

  /**
   * Subscribes to session events and filters them for the current session.
   */
  const streamSessionEvents = (args: {
    sessionID: string;
    client: OpencodeClient;
  }) =>
    Effect.gen(function* () {
      const { sessionID, client } = args;

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

  /**
   * Sends a prompt to the OpenCode session.
   */
  const firePrompt = (args: {
    sessionID: string;
    text: string;
    errorDeferred: Deferred.Deferred<never, OcError>;
    client: OpencodeClient;
  }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("Sending prompt to OpenCode...");
      return yield* Effect.promise(() =>
        args.client.session.prompt({
          path: { id: args.sessionID },
          body: {
            agent: "docs",
            model: {
              providerID: rawConfig.provider,
              modelID: rawConfig.model,
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
    });

  /**
   * Streams the prompt response, handling errors and cleanup.
   */
  const streamPrompt = (args: {
    sessionID: string;
    prompt: string;
    client: OpencodeClient;
    cleanup: () => void;
  }) =>
    Effect.gen(function* () {
      const { sessionID, prompt, client } = args;

      const eventStream = yield* streamSessionEvents({ sessionID, client });

      const errorDeferred = yield* Deferred.make<never, OcError>();

      yield* firePrompt({
        sessionID,
        text: prompt,
        errorDeferred,
        client,
      }).pipe(Effect.forkDaemon);

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
        Stream.ensuring(Effect.sync(() => args.cleanup())),
        Stream.interruptWhen(Deferred.await(errorDeferred))
      );
    });

  return {
    /**
     * Spawns the OpenCode TUI for the specified technology.
     * @param args.tech The technology/repo name to chat about.
     */
    spawnTui: (args: { tech: string }) =>
      Effect.gen(function* () {
        const { tech } = args;

        yield* Effect.logDebug(`Spawning TUI for ${tech}...`);
        yield* config.cloneOrUpdateOneRepoLocally(tech);

        const configObject = yield* config.getOpenCodeConfig({
          repoName: tech,
        });

        yield* Effect.tryPromise({
          try: () => spawnOpencodeTui({ config: configObject, rawConfig }),
          catch: (err) =>
            new OcError({ message: "TUI exited with error", cause: err }),
        });
      }),
    /**
     * Holds an OpenCode instance open in the background.
     * Useful for keeping the server warm.
     */
    holdOpenInstanceInBg: () =>
      Effect.gen(function* () {
        const { client, server } = yield* getOpencodeInstance({
          tech: "svelte",
        });

        yield* Effect.logInfo(`OPENCODE SERVER IS UP AT ${server.url}`);

        yield* Effect.sleep(Duration.days(1));
      }),
    /**
     * Asks a question about the specified technology.
     * Returns a stream of events.
     * @param args.question The question to ask.
     * @param args.tech The technology/repo to ask about.
     */
    askQuestion: (args: { question: string; tech: string }) =>
      Effect.gen(function* () {
        const { question, tech } = args;

        yield* Effect.logDebug(`Asking question about ${tech}...`);
        yield* config.cloneOrUpdateOneRepoLocally(tech);

        const { client, server } = yield* getOpencodeInstance({ tech });

        yield* validateProviderAndModel(
          client,
          rawConfig.provider,
          rawConfig.model
        );
        yield* Effect.logDebug("Provider/Model validation passed");

        yield* Effect.log(`Creating OpenCode session...`);
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
        yield* Effect.log(`Session created with ID ${sessionID}`);

        return yield* streamPrompt({
          sessionID,
          prompt: question,
          client,
          cleanup: () => {
            server.close();
          },
        });
      }),
  };
});

export class OcService extends Effect.Service<OcService>()("OcService", {
  effect: ocService,
  dependencies: [ConfigService.Default],
}) {}
