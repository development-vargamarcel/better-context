import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { HistoryService } from "../src/services/history";
import { BunContext } from "@effect/platform-bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-test-" + Math.random().toString(36).slice(2));

describe("HistoryService", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("addEntry and getEntries", async () => {
    const program = Effect.gen(function* () {
      const history = yield* HistoryService;
      yield* history.addEntry({
        tech: "svelte",
        question: "what is rune?",
        answer: "magic",
      });

      const entries = yield* history.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].tech).toBe("svelte");
      expect(entries[0].answer).toBe("magic");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(HistoryService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("getAllEntries", async () => {
    const program = Effect.gen(function* () {
      const history = yield* HistoryService;
      yield* history.addEntry({
        tech: "svelte",
        question: "q1",
        answer: "a1",
      });
      yield* history.addEntry({
        tech: "react",
        question: "q2",
        answer: "a2",
      });

      const entries = yield* history.getAllEntries();
      expect(entries.length).toBe(2);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(HistoryService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("exportHistory", async () => {
    const program = Effect.gen(function* () {
      const history = yield* HistoryService;
      yield* history.addEntry({
        tech: "svelte",
        question: "q1",
        answer: "a1",
      });

      const jsonPath = path.join(tmpDir, "history.json");
      yield* history.exportHistory("json", jsonPath);
      const jsonContent = yield* Effect.promise(() =>
        fs.readFile(jsonPath, "utf-8")
      );
      const json = JSON.parse(jsonContent);
      expect(json.length).toBe(1);
      expect(json[0].tech).toBe("svelte");

      const mdPath = path.join(tmpDir, "history.md");
      yield* history.exportHistory("markdown", mdPath);
      const mdContent = yield* Effect.promise(() =>
        fs.readFile(mdPath, "utf-8")
      );
      expect(mdContent).toContain("# BTCA History Export");
      expect(mdContent).toContain("Tech: svelte");
      expect(mdContent).toContain("**Question:** q1");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(HistoryService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("clearHistory", async () => {
    const program = Effect.gen(function* () {
      const history = yield* HistoryService;
      yield* history.addEntry({
        tech: "svelte",
        question: "what is rune?",
        answer: "magic",
      });

      yield* history.clearHistory();
      const entries = yield* history.getEntries();
      expect(entries.length).toBe(0);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(HistoryService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });
});
