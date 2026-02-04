import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-stats-test-" + Math.random().toString(36).slice(2));
const cliEntry = path.join(import.meta.dir, "../src/index.ts");

describe("Stats Command", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });

    // Create a dummy repo
    const repoPath = path.join(tmpDir, "dummy-stats-repo");
    await fs.mkdir(repoPath);
    await Bun.spawn(["git", "init", "-b", "main", repoPath]).exited;

    // Add some files
    await fs.writeFile(path.join(repoPath, "test.js"), "console.log('hello');\nconsole.log('world');");
    await fs.writeFile(path.join(repoPath, "style.css"), "body { color: red; }");
    await fs.writeFile(path.join(repoPath, "readme.md"), "# Readme");

    await Bun.spawn(["git", "add", "."], { cwd: repoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "Initial commit", "--author", "Tester <test@example.com>"], { cwd: repoPath }).exited;

    // Add another commit from another author
     await fs.writeFile(path.join(repoPath, "test2.js"), "console.log('hello');");
    await Bun.spawn(["git", "add", "."], { cwd: repoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "Second commit", "--author", "Dev <dev@example.com>"], { cwd: repoPath }).exited;
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("stats returns correct details", async () => {
    // 1. Add the repo
    const repoPath = path.join(tmpDir, "dummy-stats-repo");
    await Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-repo", "--url", repoPath], {
       env: { ...process.env, HOME: tmpDir }
    }).exited;

    // 2. Stats
    const proc = Bun.spawn(["bun", "run", cliEntry, "stats", "--tech", "test-repo"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(output).toContain("Repository Statistics: test-repo");
    expect(output).toContain("Total Files: 4"); // test.js, style.css, readme.md, test2.js

    // Lines:
    // test.js: 2
    // style.css: 1
    // readme.md: 1
    // test2.js: 1
    // Total: 5
    expect(output).toContain("Total Lines of Code: 5");

    expect(output).toContain("Top Contributors:");
    expect(output).toContain("Tester");
    expect(output).toContain("Dev");

    expect(output).toContain("Language Breakdown:");
    expect(output).toContain(".js: 2 files");
    expect(output).toContain(".css: 1 files");
    expect(output).toContain(".md: 1 files");
  });
});
