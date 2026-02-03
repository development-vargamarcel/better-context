import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { ConfigService } from "../src/services/config";
import { BunContext } from "@effect/platform-bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-clean-test-" + Math.random().toString(36).slice(2));

describe("ConfigService - Clean", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("cleanRepo removes directory but keeps config", async () => {
    // Init a dummy git repo
    const repoPath = path.join(tmpDir, "dummy-repo");
    await fs.mkdir(repoPath);
    await Bun.spawn(["git", "init", "-b", "main", repoPath]).exited;
    await fs.writeFile(path.join(repoPath, "README.md"), "# Test");
    await Bun.spawn(["git", "add", "."], { cwd: repoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "Initial commit"], { cwd: repoPath }).exited;

    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;

      const newRepo = {
        name: "test-repo",
        url: repoPath,
        branch: "main"
      };

      yield* configService.addRepo(newRepo);

      // Ensure it's "downloaded" (local path exists)
      const localPath = yield* configService.getRepoPath("test-repo");
      let stats = yield* Effect.tryPromise(() => fs.stat(localPath));
      expect(stats.isDirectory()).toBe(true);

      // Clean it
      yield* configService.cleanRepo("test-repo");

      // Check directory is gone
      const exists = yield* Effect.tryPromise(() => fs.access(localPath).then(() => true).catch(() => false));
      expect(exists).toBe(false);

      // Check config still has it
      const config = yield* configService.rawConfig();
      expect(config.repos.find(r => r.name === "test-repo")).toBeDefined();
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });

  test("cleanAllRepos removes all directories", async () => {
    // Init dummy repos
    const repo1Path = path.join(tmpDir, "dummy-repo-1");
    const repo2Path = path.join(tmpDir, "dummy-repo-2");

    for (const p of [repo1Path, repo2Path]) {
        await fs.mkdir(p);
        await Bun.spawn(["git", "init", "-b", "main", p]).exited;
        await fs.writeFile(path.join(p, "README.md"), "# Test");
        await Bun.spawn(["git", "add", "."], { cwd: p }).exited;
        await Bun.spawn(["git", "commit", "-m", "Initial commit"], { cwd: p }).exited;
    }

    const program = Effect.gen(function* () {
      const configService = yield* ConfigService;

      yield* configService.addRepo({ name: "repo-1", url: repo1Path, branch: "main" });
      yield* configService.addRepo({ name: "repo-2", url: repo2Path, branch: "main" });

      // Ensure they exist locally
      const localPath1 = yield* configService.getRepoPath("repo-1");
      const localPath2 = yield* configService.getRepoPath("repo-2");

      expect((yield* Effect.tryPromise(() => fs.stat(localPath1))).isDirectory()).toBe(true);
      expect((yield* Effect.tryPromise(() => fs.stat(localPath2))).isDirectory()).toBe(true);

      // Clean all
      yield* configService.cleanAllRepos();

      // Check directories are gone
      const exists1 = yield* Effect.tryPromise(() => fs.access(localPath1).then(() => true).catch(() => false));
      const exists2 = yield* Effect.tryPromise(() => fs.access(localPath2).then(() => true).catch(() => false));

      expect(exists1).toBe(false);
      expect(exists2).toBe(false);

      // Check config still has them
      const config = yield* configService.rawConfig();
      expect(config.repos.find(r => r.name === "repo-1")).toBeDefined();
      expect(config.repos.find(r => r.name === "repo-2")).toBeDefined();
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(BunContext.layer)
      )
    );
  });
});
