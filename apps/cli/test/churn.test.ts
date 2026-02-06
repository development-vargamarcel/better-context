import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-churn-test-" + Math.random().toString(36).slice(2));
const cliEntry = path.join(import.meta.dir, "../src/index.ts");

describe("Churn Command", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });

    // Create a dummy repo
    const repoPath = path.join(tmpDir, "dummy-churn-repo");
    await fs.mkdir(repoPath);
    await Bun.spawn(["git", "init", "-b", "main", repoPath]).exited;

    // Add some files
    await fs.writeFile(path.join(repoPath, "test.js"), "console.log('hello');");
    await fs.writeFile(path.join(repoPath, "other.js"), "console.log('other');");

    await Bun.spawn(["git", "add", "."], { cwd: repoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "Initial commit"], { cwd: repoPath }).exited;

    // Modify test.js (1st change)
    await fs.writeFile(path.join(repoPath, "test.js"), "console.log('hello world');");
    await Bun.spawn(["git", "add", "."], { cwd: repoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "Modify test.js"], { cwd: repoPath }).exited;

    // Modify test.js (2nd change)
    await fs.writeFile(path.join(repoPath, "test.js"), "console.log('hello universe');");
    await Bun.spawn(["git", "add", "."], { cwd: repoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "Modify test.js again"], { cwd: repoPath }).exited;

    // Modify other.js (1st change)
    await fs.writeFile(path.join(repoPath, "other.js"), "console.log('other updated');");
    await Bun.spawn(["git", "add", "."], { cwd: repoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "Modify other.js"], { cwd: repoPath }).exited;
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("churn returns correct ranking", async () => {
    // 1. Add the repo
    const repoPath = path.join(tmpDir, "dummy-churn-repo");
    await Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-repo", "--url", repoPath], {
       env: { ...process.env, HOME: tmpDir }
    }).exited;

    // 2. Churn
    const proc = Bun.spawn(["bun", "run", cliEntry, "churn", "--tech", "test-repo"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(output).toContain("High Churn Files: test-repo");

    // We expect test.js to be higher than other.js
    // test.js was modified in initial commit + 2 subsequent commits = 3 times?
    // git log --name-only lists files changed in each commit.
    // Initial: test.js, other.js
    // 2nd: test.js
    // 3rd: test.js
    // 4th: other.js
    // Total: test.js (3), other.js (2)

    // Output format: "   3 test.js"

    // Check order or presence with count
    // Using regex to match lines
    const testMatch = output.match(/(\d+)\s+test\.js/);
    const otherMatch = output.match(/(\d+)\s+other\.js/);

    expect(testMatch).not.toBeNull();
    expect(otherMatch).not.toBeNull();

    if (testMatch && otherMatch) {
        expect(parseInt(testMatch[1])).toBeGreaterThanOrEqual(parseInt(otherMatch[1]));
        expect(parseInt(testMatch[1])).toBe(3);
        expect(parseInt(otherMatch[1])).toBe(2);
    }
  });
});
