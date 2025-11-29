import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer, Stream } from "effect";
import { OcService, type OcEvent } from "./services/oc.ts";

const programLayer = Layer.mergeAll(OcService.Default);

const logEvent = (event: OcEvent) => {
  if (event.type === "message.part.updated") {
    const part = event.properties.part as {
      type: string;
      text?: string;
      tool?: string;
      state?: { status?: string; title?: string };
    };
    if (part.type === "text" && part.text) {
      process.stdout.write(part.text);
    }
    if (part.type === "tool" && part.state?.status === "completed") {
      console.log(`\n[Tool Done] ${part.tool}: ${part.state.title ?? ""}`);
    }
  }
};

const program = Effect.gen(function* () {
  yield* Effect.log("STARTING UP...");

  const oc = yield* OcService;

  const eventStream = yield* oc.askQuestion({
    tech: "effect",
    question: "How does effect.tap work? When would I want to use it?",
  });

  yield* eventStream.pipe(
    Stream.runForEach((event) => Effect.sync(() => logEvent(event)))
  );

  console.log("\n\n--- PROMPT COMPLETE ---");
}).pipe(
  Effect.provide(programLayer),
  Effect.catchAll((error) => {
    console.error("Error:", error);
    return Effect.void;
  })
);

BunRuntime.runMain(program);
