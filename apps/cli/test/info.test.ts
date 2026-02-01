import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-info-test-" + Math.random().toString(36).slice(2));
const cliEntry = path.join(import.meta.dir, "../src/index.ts");

describe("Info Command", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });

    // Create a dummy repo
    const repoPath = path.join(tmpDir, "dummy-info-repo");
    await fs.mkdir(repoPath);
    await Bun.spawn(["git", "init", "-b", "main", repoPath]).exited;
    await fs.writeFile(path.join(repoPath, "test.txt"), "some content");
    await Bun.spawn(["git", "add", "."], { cwd: repoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "Initial commit", "--author", "Tester <test@example.com>"], { cwd: repoPath }).exited;
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("info returns correct details", async () => {
    // 1. Add the repo
    const repoPath = path.join(tmpDir, "dummy-info-repo");
    await Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-repo", "--url", repoPath], {
       env: { ...process.env, HOME: tmpDir }
    }).exited;

    // 2. Info
    const proc = Bun.spawn(["bun", "run", cliEntry, "info", "--tech", "test-repo"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(output).toContain("Repository: test-repo");
    expect(output).toContain("URL: " + repoPath);
    expect(output).toContain("Branch: main");
    expect(output).toContain("Latest Commit:");
    expect(output).toContain("Author: Tester");
    expect(output).toContain("Message: Initial commit");
    expect(output).toContain("File Count: 1");
  });
});
