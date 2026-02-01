import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-search-test-" + Math.random().toString(36).slice(2));
const cliEntry = path.join(import.meta.dir, "../src/index.ts");

describe("Search Command", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });

    // Create a dummy repo
    const repoPath = path.join(tmpDir, "dummy-search-repo");
    await fs.mkdir(repoPath);
    await Bun.spawn(["git", "init", "-b", "main", repoPath]).exited;
    await fs.writeFile(path.join(repoPath, "test.txt"), "This is a secret keyword inside.");
    await fs.writeFile(path.join(repoPath, "other.txt"), "Nothing here.");
    await Bun.spawn(["git", "add", "."], { cwd: repoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "Initial commit"], { cwd: repoPath }).exited;
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("search returns matches", async () => {
    // 1. Add the repo
    const repoPath = path.join(tmpDir, "dummy-search-repo");
    await Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-repo", "--url", repoPath], {
       env: { ...process.env, HOME: tmpDir }
    }).exited;

    // 2. Search
    const proc = Bun.spawn(["bun", "run", cliEntry, "search", "--tech", "test-repo", "--query", "secret"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    // Strip ANSI codes
    const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '').replace(/\u001b\[K/g, '');

    expect(proc.exitCode).toBe(0);
    expect(cleanOutput).toContain("test.txt");
    expect(cleanOutput).toContain("secret keyword");
  });

  test("search returns nothing for no matches", async () => {
    // 1. Add the repo
    const repoPath = path.join(tmpDir, "dummy-search-repo");
    await Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-repo", "--url", repoPath], {
       env: { ...process.env, HOME: tmpDir }
    }).exited;

    // 2. Search
    const proc = Bun.spawn(["bun", "run", cliEntry, "search", "--tech", "test-repo", "--query", "nonexistent"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(output).toContain("No matches found");
  });
});
