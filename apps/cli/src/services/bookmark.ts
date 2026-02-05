import { Effect, Schema } from "effect";
import { JsonStore } from "../lib/json-store.ts";

const BOOKMARK_FILENAME = "bookmarks.json";

const bookmarkSchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.Number,
  tech: Schema.String,
  question: Schema.String,
  answer: Schema.String,
  note: Schema.optional(Schema.String),
});

const bookmarksDataSchema = Schema.Struct({
  bookmarks: Schema.Array(bookmarkSchema),
});

export type BookmarksData = typeof bookmarksDataSchema.Type;
export type Bookmark = typeof bookmarkSchema.Type;

const DEFAULT_BOOKMARKS: BookmarksData = {
  bookmarks: [],
};

const store = new JsonStore(BOOKMARK_FILENAME, bookmarksDataSchema, DEFAULT_BOOKMARKS);

const bookmarkService = Effect.gen(function* () {
  return {
    /**
     * Adds a new bookmark.
     * @param entry The bookmark entry to add.
     */
    addBookmark: (entry: Omit<Bookmark, "id" | "timestamp">) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Adding bookmark for tech: ${entry.tech}`);
        const data = yield* store.load;
        const newBookmark: Bookmark = {
          ...entry,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        };
        const updatedBookmarks = [newBookmark, ...data.bookmarks];
        yield* store.save({ bookmarks: updatedBookmarks });
        yield* Effect.logInfo(`Added bookmark: ${newBookmark.id}`);
        return newBookmark;
      }),
    /**
     * Retrieves all bookmarks.
     */
    getBookmarks: () =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Retrieving all bookmarks");
        const data = yield* store.load;
        return data.bookmarks;
      }),
    /**
     * Removes a bookmark by ID.
     * @param id The ID of the bookmark to remove.
     */
    removeBookmark: (id: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(`Removing bookmark: ${id}`);
        const data = yield* store.load;
        const updatedBookmarks = data.bookmarks.filter((b) => b.id !== id);
        if (updatedBookmarks.length === data.bookmarks.length) {
             yield* Effect.logWarning(`Bookmark not found: ${id}`);
             return false;
        }
        yield* store.save({ bookmarks: updatedBookmarks });
        yield* Effect.logInfo(`Removed bookmark: ${id}`);
        return true;
      }),
  };
});

export class BookmarkService extends Effect.Service<BookmarkService>()(
  "BookmarkService",
  {
    effect: bookmarkService,
  }
) {}
