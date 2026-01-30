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

/**
 * Resolves the path to the history file.
 */
const getHistoryPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const historyDir = yield* expandHome(HISTORY_DIRECTORY);
  return path.join(historyDir, HISTORY_FILENAME);
});

/**
 * Loads the history from the file system.
 * Returns default history if file doesn't exist or is invalid.
 */
const loadHistory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const historyPath = yield* getHistoryPath;
  const historyDir = yield* expandHome(HISTORY_DIRECTORY);

  yield* ensureDirectory(historyDir);

  const exists = yield* fs.exists(historyPath);

  if (!exists) {
    yield* Effect.logDebug("History file does not exist, using default");
    return DEFAULT_HISTORY;
  }

  yield* Effect.logDebug(`Loading history from ${historyPath}`);
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

/**
 * Saves the history to the file system.
 */
const saveHistory = (history: History) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const historyPath = yield* getHistoryPath;

    yield* Effect.logDebug(`Saving history to ${historyPath}`);
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
    /**
     * Adds a new entry to the history.
     * Trims history to the last 100 entries.
     * @param entry The history entry to add.
     */
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
        yield* Effect.logDebug(`Added history entry: ${newEntry.id}`);
        return newEntry;
      }),
    /**
     * Retrieves the most recent history entries.
     * @param limit The maximum number of entries to retrieve. Defaults to 10.
     */
    getEntries: (limit = 10) =>
      Effect.gen(function* () {
        const history = yield* loadHistory;
        return history.entries.slice(0, limit);
      }),
    /**
     * Retrieves all history entries.
     */
    getAllEntries: () =>
      Effect.gen(function* () {
        const history = yield* loadHistory;
        return history.entries;
      }),
    /**
     * Exports the history to a file in the specified format.
     * @param format The format to export to ("json" | "markdown").
     * @param output The path to the output file.
     */
    exportHistory: (format: "json" | "markdown", output: string) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const history = yield* loadHistory;
        let content = "";

        if (format === "json") {
          content = JSON.stringify(history.entries, null, 2);
        } else {
          content = "# BTCA History Export\n\n";
          for (const entry of history.entries) {
            const date = new Date(entry.timestamp).toLocaleString();
            content += `## [${date}] Tech: ${entry.tech}\n\n`;
            content += `**Question:** ${entry.question}\n\n`;
            content += `**Answer:**\n\n\`\`\`\n${entry.answer}\n\`\`\`\n\n`;
            content += "---\n\n";
          }
        }

        yield* fs.writeFileString(output, content);
        yield* Effect.logInfo(`History exported to ${output} in ${format} format`);
      }),
    /**
     * Clears all history entries.
     */
    clearHistory: () =>
      Effect.gen(function* () {
        yield* saveHistory(DEFAULT_HISTORY);
        yield* Effect.logInfo("History cleared");
      }),
  };
});

export class HistoryService extends Effect.Service<HistoryService>()(
  "HistoryService",
  {
    effect: historyService,
  }
) {}
