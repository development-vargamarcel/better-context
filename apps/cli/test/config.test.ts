import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { ConfigService } from "../src/services/config";
import { BunContext } from "@effect/platform-bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-config-test-" + Math.random().toString(36).slice(2));

describe("ConfigService", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("default config creation", async () => {
    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;
      const config = yield* configService.rawConfig();
      expect(config.repos.length).toBeGreaterThan(0);
      expect(config.provider).toBe("opencode");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("addRepo and removeRepo", async () => {
    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;

      const newRepo = {
        name: "test-repo",
        url: "https://example.com",
        branch: "main"
      };

      yield* configService.addRepo(newRepo);

      let config = yield* configService.rawConfig();
      expect(config.repos.find(r => r.name === "test-repo")).toBeDefined();

      yield* configService.removeRepo({ name: "test-repo", deleteFiles: false });

      config = yield* configService.rawConfig();
      expect(config.repos.find(r => r.name === "test-repo")).toBeUndefined();
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("updateModel", async () => {
    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;

      yield* configService.updateModel({ provider: "openai", model: "gpt-4" });

      const config = yield* configService.rawConfig();
      expect(config.provider).toBe("openai");
      expect(config.model).toBe("gpt-4");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("resetConfig", async () => {
    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;

      // Modify config first
      yield* configService.updateModel({ provider: "changed", model: "changed" });

      // Reset
      yield* configService.resetConfig();

      const config = yield* configService.rawConfig();
      expect(config.provider).toBe("opencode");
      expect(config.model).toBe("big-pickle");
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });
});
