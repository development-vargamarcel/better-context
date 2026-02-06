import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { ConfigService } from "../src/services/config.ts";
import { BunContext } from "@effect/platform-bun";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

describe("Diff Command", () => {
  const TEST_DIR = path.join(os.tmpdir(), `btca-diff-test-${Math.random().toString(36).slice(2)}`);
  const CONFIG_DIR = path.join(TEST_DIR, ".config/btca");
  const REPOS_DIR = path.join(CONFIG_DIR, "repos");
  const REPO_NAME = "test-repo";
  const REPO_DIR = path.join(REPOS_DIR, REPO_NAME);

  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    process.env.HOME = TEST_DIR;
    await fs.mkdir(REPOS_DIR, { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  const setupRepo = async () => {
    await fs.mkdir(REPO_DIR, { recursive: true });
    await Bun.spawn(["git", "init"], { cwd: REPO_DIR }).exited;
    await Bun.spawn(["git", "config", "user.name", "Test User"], { cwd: REPO_DIR }).exited;
    await Bun.spawn(["git", "config", "user.email", "test@example.com"], { cwd: REPO_DIR }).exited;

    await fs.writeFile(path.join(REPO_DIR, "file.txt"), "hello");
    await Bun.spawn(["git", "add", "."], { cwd: REPO_DIR }).exited;
    await Bun.spawn(["git", "commit", "-m", "Initial commit"], { cwd: REPO_DIR }).exited;

    const configFile = path.join(CONFIG_DIR, "btca.json");
    const config = {
      promptsDirectory: "~/.config/btca/prompts",
      reposDirectory: "~/.config/btca/repos",
      port: 3420,
      maxInstances: 5,
      repos: [
        {
          name: REPO_NAME,
          url: `file://${REPO_DIR}`,
          branch: "main",
        }
      ],
      model: "big-pickle",
      provider: "opencode",
    };
    await fs.writeFile(configFile, JSON.stringify(config));
  };

  test("getRepoDiff returns unstaged changes", async () => {
    await setupRepo();

    // Modify file
    await fs.writeFile(path.join(REPO_DIR, "file.txt"), "hello modified");

    const program = Effect.gen(function* () {
      const config = yield* ConfigService;
      const diff = yield* config.getRepoDiff(REPO_NAME, false);
      return diff;
    });

    const diff = await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
    // Strip ANSI codes
    const cleanDiff = diff.replace(/\u001b\[[0-9;]*m/g, "");
    expect(cleanDiff).toContain("diff --git a/file.txt b/file.txt");
    expect(cleanDiff).toContain("+hello modified");
  });

  test("getRepoDiff returns staged changes when cached=true", async () => {
    await setupRepo();

    // Modify file and stage it
    await fs.writeFile(path.join(REPO_DIR, "file.txt"), "hello staged");
    await Bun.spawn(["git", "add", "."], { cwd: REPO_DIR }).exited;

    const program = Effect.gen(function* () {
      const config = yield* ConfigService;
      const diff = yield* config.getRepoDiff(REPO_NAME, true);
      return diff;
    });

    const diff = await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
    // Strip ANSI codes
    const cleanDiff = diff.replace(/\u001b\[[0-9;]*m/g, "");
    expect(cleanDiff).toContain("diff --git a/file.txt b/file.txt");
    expect(cleanDiff).toContain("+hello staged");
  });
});
