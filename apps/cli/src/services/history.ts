import { FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";
import { ConfigError } from "../lib/errors.ts";
import { expandHome, ensureDirectory } from "../lib/utils/files.ts";

const HISTORY_DIRECTORY = "~/.config/btca";
const HISTORY_FILENAME = "history.json";

const historyEntrySchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.Number,
  tech: Schema.String,
  question: Schema.String,
  answer: Schema.String,
});

const historySchema = Schema.Struct({
  entries: Schema.Array(historyEntrySchema),
});

export type History = typeof historySchema.Type;
export type HistoryEntry = typeof historyEntrySchema.Type;

const DEFAULT_HISTORY: History = {
  entries: [],
};

const getHistoryPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const historyDir = yield* expandHome(HISTORY_DIRECTORY);
  return path.join(historyDir, HISTORY_FILENAME);
});

const loadHistory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const historyPath = yield* getHistoryPath;
  const historyDir = yield* expandHome(HISTORY_DIRECTORY);

  yield* ensureDirectory(historyDir);

  const exists = yield* fs.exists(historyPath);

  if (!exists) {
    return DEFAULT_HISTORY;
  }

  const content = yield* fs.readFileString(historyPath).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new ConfigError({
          message: "Failed to read history file",
          cause: error,
        })
      )
    )
  );

  if (!content.trim()) {
    return DEFAULT_HISTORY;
  }

  try {
    const parsed = JSON.parse(content);
    return yield* Schema.decodeUnknown(historySchema)(parsed).pipe(
      Effect.catchAll(() => Effect.succeed(DEFAULT_HISTORY))
    );
  } catch {
    return DEFAULT_HISTORY;
  }
});

const saveHistory = (history: History) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const historyPath = yield* getHistoryPath;

    yield* fs
      .writeFileString(historyPath, JSON.stringify(history, null, 2))
      .pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            new ConfigError({
              message: "Failed to write history file",
              cause: error,
            })
          )
        )
      );
  });

const historyService = Effect.gen(function* () {
  return {
    addEntry: (entry: Omit<HistoryEntry, "id" | "timestamp">) =>
      Effect.gen(function* () {
        const history = yield* loadHistory;
        const newEntry: HistoryEntry = {
          ...entry,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        };
        // Keep only last 100 entries to avoid file growing too large
        const updatedEntries = [newEntry, ...history.entries].slice(0, 100);
        yield* saveHistory({ entries: updatedEntries });
        return newEntry;
      }),
    getEntries: (limit = 10) =>
      Effect.gen(function* () {
        const history = yield* loadHistory;
        return history.entries.slice(0, limit);
      }),
    clearHistory: () =>
      Effect.gen(function* () {
        yield* saveHistory(DEFAULT_HISTORY);
      }),
  };
});

export class HistoryService extends Effect.Service<HistoryService>()(
  "HistoryService",
  {
    effect: historyService,
  }
) {}
