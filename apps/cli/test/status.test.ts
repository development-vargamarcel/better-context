import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const tmpDir = path.join(os.tmpdir(), "btca-status-test-" + Math.random().toString(36).slice(2));
const cliEntry = path.join(import.meta.dir, "../src/index.ts");

describe("Status Command", () => {
  const OriginalHome = Bun.env.HOME;

  beforeEach(async () => {
    Bun.env.HOME = tmpDir;
    await fs.mkdir(tmpDir, { recursive: true });

    // Create a dummy remote repo
    const remoteRepoPath = path.join(tmpDir, "remote-repo");
    await fs.mkdir(remoteRepoPath);
    await Bun.spawn(["git", "init", "-b", "main", remoteRepoPath]).exited;
    await fs.writeFile(path.join(remoteRepoPath, "test.txt"), "v1");
    await Bun.spawn(["git", "add", "."], { cwd: remoteRepoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "v1", "--author", "Tester <test@example.com>"], { cwd: remoteRepoPath }).exited;
  });

  afterEach(async () => {
    Bun.env.HOME = OriginalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("status reports up to date", async () => {
    const remoteRepoPath = path.join(tmpDir, "remote-repo");

    // Add repo
    await Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-repo", "--url", remoteRepoPath], {
       env: { ...process.env, HOME: tmpDir }
    }).exited;

    // Clone it
    await Bun.spawn(["bun", "run", cliEntry, "info", "-t", "test-repo"], {
        env: { ...process.env, HOME: tmpDir }
     }).exited;

    // Status
    const proc = Bun.spawn(["bun", "run", cliEntry, "status", "-t", "test-repo"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain("Status: Up to date");
  });

  test("status reports behind", async () => {
    const remoteRepoPath = path.join(tmpDir, "remote-repo");

    // Add repo
    await Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-repo", "--url", remoteRepoPath], {
       env: { ...process.env, HOME: tmpDir }
    }).exited;

    // Clone it first (so we are at v1)
    await Bun.spawn(["bun", "run", cliEntry, "info", "-t", "test-repo"], {
        env: { ...process.env, HOME: tmpDir }
     }).exited;

    // Update remote
    await fs.writeFile(path.join(remoteRepoPath, "test.txt"), "v2");
    await Bun.spawn(["git", "add", "."], { cwd: remoteRepoPath }).exited;
    await Bun.spawn(["git", "commit", "-m", "v2", "--author", "Tester <test@example.com>"], { cwd: remoteRepoPath }).exited;

    // Status (should auto fetch)
    const proc = Bun.spawn(["bun", "run", cliEntry, "status", "-t", "test-repo"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain("Status: Behind by 1 commits");
  });

  test("status reports dirty", async () => {
    const remoteRepoPath = path.join(tmpDir, "remote-repo");

    // Add repo
    await Bun.spawn(["bun", "run", cliEntry, "config", "repos", "add", "--name", "test-repo", "--url", remoteRepoPath], {
       env: { ...process.env, HOME: tmpDir }
    }).exited;

    // Clone it
    await Bun.spawn(["bun", "run", cliEntry, "info", "-t", "test-repo"], {
        env: { ...process.env, HOME: tmpDir }
     }).exited;

    // Make local dirty
    // First we need to know where it is cloned. Defaults to ~/.config/btca/repos/test-repo
    const localRepoPath = path.join(tmpDir, ".config/btca/repos/test-repo");

    await fs.writeFile(path.join(localRepoPath, "test.txt"), "dirty content");

    // Status
    const proc = Bun.spawn(["bun", "run", cliEntry, "status", "-t", "test-repo"], {
        env: { ...process.env, HOME: tmpDir },
        stderr: "pipe",
        stdout: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain("Status: Dirty");
  });
});
