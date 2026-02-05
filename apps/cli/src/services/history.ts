import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import { JsonStore } from "../lib/json-store.ts";

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

const store = new JsonStore(HISTORY_FILENAME, historySchema, DEFAULT_HISTORY);

const historyService = Effect.gen(function* () {
  return {
    /**
     * Adds a new entry to the history.
     * Trims history to the last 100 entries.
     * @param entry The history entry to add.
     */
    addEntry: (entry: Omit<HistoryEntry, "id" | "timestamp">) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Adding history entry for tech: ${entry.tech}`);
        const history = yield* store.load;
        const newEntry: HistoryEntry = {
          ...entry,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        };
        // Keep only last 100 entries to avoid file growing too large
        const updatedEntries = [newEntry, ...history.entries].slice(0, 100);
        yield* store.save({ entries: updatedEntries });
        yield* Effect.logDebug(`Added history entry: ${newEntry.id}`);
        return newEntry;
      }),
    /**
     * Retrieves the most recent history entries.
     * @param limit The maximum number of entries to retrieve. Defaults to 10.
     */
    getEntries: (limit = 10) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Retrieving ${limit} history entries`);
        const history = yield* store.load;
        return history.entries.slice(0, limit);
      }),
    /**
     * Retrieves all history entries.
     */
    getAllEntries: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Retrieving all history entries");
        const history = yield* store.load;
        return history.entries;
      }),
    /**
     * Exports the history to a file in the specified format.
     * @param format The format to export to ("json" | "markdown").
     * @param output The path to the output file.
     */
    exportHistory: (format: "json" | "markdown", output: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Exporting history to ${output} in ${format} format`);
        const fs = yield* FileSystem.FileSystem;
        const history = yield* store.load;
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
        yield* Effect.logDebug("Clearing history");
        yield* store.save(DEFAULT_HISTORY);
        yield* Effect.logInfo("History cleared");
      }),
    /**
     * Calculates statistics from the history.
     */
    getStats: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Calculating history statistics");
        const history = yield* store.load;
        const totalQuestions = history.entries.length;
        const techCounts: Record<string, number> = {};
        let lastActivity = 0;

        for (const entry of history.entries) {
          techCounts[entry.tech] = (techCounts[entry.tech] || 0) + 1;
          if (entry.timestamp > lastActivity) {
            lastActivity = entry.timestamp;
          }
        }

        yield* Effect.logDebug(`Stats calculated: ${totalQuestions} questions`);

        return {
          totalQuestions,
          techCounts,
          lastActivity,
        };
      }),
  };
});

export class HistoryService extends Effect.Service<HistoryService>()(
  "HistoryService",
  {
    effect: historyService,
  }
) {}
