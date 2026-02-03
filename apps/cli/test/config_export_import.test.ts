import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { ConfigService } from "../src/services/config";
import { BunContext } from "@effect/platform-bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-config-export-test-" + Math.random().toString(36).slice(2));

describe("Config Export/Import", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("exportConfig creates a file with current config", async () => {
    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;

      // Modify default config slightly
      yield* configService.updateModel({ provider: "test-provider", model: "test-model" });

      const exportPath = path.join(tmpDir, "exported-config.json");
      yield* configService.exportConfig(exportPath);

      const content = yield* Effect.tryPromise(() => fs.readFile(exportPath, "utf-8"));
      const parsed = JSON.parse(content);

      expect(parsed.provider).toBe("test-provider");
      expect(parsed.model).toBe("test-model");
      // Check if paths are collapsed (should start with ~)
      expect(parsed.promptsDirectory.startsWith("~")).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("importConfig loads config from file and updates current config", async () => {
    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;

      // Create a config file to import
      const importPath = path.join(tmpDir, "import-config.json");
      const configToImport = {
        promptsDirectory: "~/prompts",
        reposDirectory: "~/repos",
        port: 4000,
        maxInstances: 10,
        repos: [
           { name: "imported-repo", url: "https://example.com/repo", branch: "dev" }
        ],
        model: "imported-model",
        provider: "imported-provider"
      };

      yield* Effect.tryPromise(() => fs.writeFile(importPath, JSON.stringify(configToImport)));

      yield* configService.importConfig(importPath);

      const currentConfig = yield* configService.rawConfig();
      expect(currentConfig.provider).toBe("imported-provider");
      expect(currentConfig.model).toBe("imported-model");
      expect(currentConfig.port).toBe(4000);
      expect(currentConfig.repos.length).toBe(1);
      expect(currentConfig.repos[0].name).toBe("imported-repo");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("importConfig fails if file does not exist", async () => {
    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;
      const importPath = path.join(tmpDir, "non-existent.json");

      yield* configService.importConfig(importPath);
    });

    const exit = await Effect.runPromiseExit(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );

    expect(exit._tag).toBe("Failure");
  });

  test("importConfig fails if file is invalid JSON", async () => {
    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;
      const importPath = path.join(tmpDir, "invalid.json");
      yield* Effect.tryPromise(() => fs.writeFile(importPath, "{ invalid json "));

      yield* configService.importConfig(importPath);
    });

    const exit = await Effect.runPromiseExit(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );

    expect(exit._tag).toBe("Failure");
  });

  test("importConfig fails if schema does not match", async () => {
    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;
      const importPath = path.join(tmpDir, "bad-schema.json");
      yield* Effect.tryPromise(() => fs.writeFile(importPath, JSON.stringify({
          repos: "should be array", // Invalid type
          model: 123 // Invalid type
      })));

      yield* configService.importConfig(importPath);
    });

    const exit = await Effect.runPromiseExit(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );

    expect(exit._tag).toBe("Failure");
  });

});
