import { FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";
import { ConfigError } from "./errors.ts";
import { ensureDirectory, expandHome } from "./utils/files.ts";

export class JsonStore<T> {
  constructor(
    private readonly filename: string,
    private readonly schema: Schema.Schema<T>,
    private readonly defaultData: T
  ) {}

  private getPath = Effect.gen(this, function* () {
    const path = yield* Path.Path;
    const homeDir = yield* expandHome("~/.config/btca");
    return path.join(homeDir, this.filename);
  });

  load = Effect.gen(this, function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = yield* this.getPath;
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));

    yield* ensureDirectory(dir);

    const exists = yield* fs.exists(filePath);

    if (!exists) {
      yield* Effect.logDebug(`File does not exist, using default: ${filePath}`);
      return this.defaultData;
    }

    yield* Effect.logDebug(`Loading data from ${filePath}`);
    const content = yield* fs.readFileString(filePath).pipe(
      Effect.catchAll((error) =>
        Effect.fail(
          new ConfigError({
            message: `Failed to read file ${this.filename}`,
            cause: error,
          })
        )
      )
    );

    if (!content.trim()) {
      return this.defaultData;
    }

    try {
      const parsed = JSON.parse(content);
      return yield* Schema.decodeUnknown(this.schema)(parsed).pipe(
        Effect.catchAll((e) => {
            Effect.logWarning(`Schema validation failed for ${this.filename}: ${e}`);
            return Effect.succeed(this.defaultData)
        })
      );
    } catch (e) {
      yield* Effect.logWarning(`Failed to parse JSON for ${this.filename}: ${e}`);
      return this.defaultData;
    }
  });

  save = (data: T) =>
    Effect.gen(this, function* () {
      const fs = yield* FileSystem.FileSystem;
      const filePath = yield* this.getPath;

      yield* Effect.logDebug(`Saving data to ${filePath}`);
      yield* fs
        .writeFileString(filePath, JSON.stringify(data, null, 2))
        .pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new ConfigError({
                message: `Failed to write file ${this.filename}`,
                cause: error,
              })
            )
          )
        );
    });
}
