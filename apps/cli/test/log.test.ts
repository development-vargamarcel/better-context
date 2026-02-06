import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { ConfigService } from "../src/services/config.ts";
import { BunContext } from "@effect/platform-bun";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

describe("Log Command", () => {
  const TEST_DIR = path.join(os.tmpdir(), `btca-log-test-${Math.random().toString(36).slice(2)}`);
  const CONFIG_DIR = path.join(TEST_DIR, ".config/btca");
  const REPOS_DIR = path.join(CONFIG_DIR, "repos");
  const REPO_NAME = "test-repo";
  const REPO_DIR = path.join(REPOS_DIR, REPO_NAME); // ConfigService will look here

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

  // Helper to setup a dummy repo
  const setupRepo = async () => {
    // Initialize git repo at the expected location
    await fs.mkdir(REPO_DIR, { recursive: true });
    await Bun.spawn(["git", "init"], { cwd: REPO_DIR }).exited;
    await Bun.spawn(["git", "config", "user.name", "Test User"], { cwd: REPO_DIR }).exited;
    await Bun.spawn(["git", "config", "user.email", "test@example.com"], { cwd: REPO_DIR }).exited;

    // Create a commit
    await fs.writeFile(path.join(REPO_DIR, "file.txt"), "hello");
    await Bun.spawn(["git", "add", "."], { cwd: REPO_DIR }).exited;
    await Bun.spawn(["git", "commit", "-m", "Initial commit"], { cwd: REPO_DIR }).exited;

    // Create another commit
    await fs.writeFile(path.join(REPO_DIR, "file.txt"), "hello world");
    await Bun.spawn(["git", "add", "."], { cwd: REPO_DIR }).exited;
    await Bun.spawn(["git", "commit", "-m", "Second commit"], { cwd: REPO_DIR }).exited;

    // We need to inject it into config.
    const configFile = path.join(CONFIG_DIR, "btca.json");
    const config = {
      promptsDirectory: "~/.config/btca/prompts",
      reposDirectory: "~/.config/btca/repos",
      port: 3420,
      maxInstances: 5,
      repos: [
        {
          name: REPO_NAME,
          url: `file://${REPO_DIR}`, // Dummy URL
          branch: "main",
        }
      ],
      model: "big-pickle",
      provider: "opencode",
    };
    await fs.writeFile(configFile, JSON.stringify(config));
  };

  test("getRepoLog returns commit history", async () => {
    await setupRepo();

    const program = Effect.gen(function* () {
      const config = yield* ConfigService;
      const log = yield* config.getRepoLog(REPO_NAME, 10, false);
      return log;
    });

    const log = await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
    expect(log).toContain("Second commit");
    expect(log).toContain("Initial commit");
  });
});
