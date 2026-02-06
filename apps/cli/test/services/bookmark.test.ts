import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { BookmarkService } from "../../src/services/bookmark";
import { BunContext } from "@effect/platform-bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-bookmark-test-" + Math.random().toString(36).slice(2));

describe("BookmarkService", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("addBookmark and getBookmarks", async () => {
    const program = Effect.gen(function* () {
      const service = yield* BookmarkService;
      yield* service.addBookmark({
        tech: "svelte",
        question: "what is rune?",
        answer: "magic",
        note: "My note"
      });

      const bookmarks = yield* service.getBookmarks();
      expect(bookmarks.length).toBe(1);
      expect(bookmarks[0].tech).toBe("svelte");
      expect(bookmarks[0].answer).toBe("magic");
      expect(bookmarks[0].note).toBe("My note");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(BookmarkService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("removeBookmark", async () => {
    const program = Effect.gen(function* () {
      const service = yield* BookmarkService;
      const b = yield* service.addBookmark({
        tech: "react",
        question: "q1",
        answer: "a1",
      });

      const bookmarksBefore = yield* service.getBookmarks();
      expect(bookmarksBefore.length).toBe(1);

      const result = yield* service.removeBookmark(b.id);
      expect(result).toBe(true);

      const bookmarksAfter = yield* service.getBookmarks();
      expect(bookmarksAfter.length).toBe(0);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(BookmarkService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("removeBookmark not found", async () => {
    const program = Effect.gen(function* () {
        const service = yield* BookmarkService;
        const result = yield* service.removeBookmark("non-existent-id");
        expect(result).toBe(false);
    });

    await Effect.runPromise(
        program.pipe(
            Effect.provide(BookmarkService.Default),
            Effect.provide(BunContext.layer)
        )
    );
  });
});
