import { Effect } from "effect";
import { ConfigError } from "./errors.ts";

export const getLanguageBreakdown = (repoPath: string) =>
  Effect.gen(function* () {
    const proc = Bun.spawn(["git", "ls-files"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = yield* Effect.tryPromise(() => new Response(proc.stdout).text());
    yield* Effect.tryPromise(() => proc.exited);

    if (proc.exitCode !== 0) {
      return yield* Effect.fail(
        new ConfigError({ message: "Failed to list files" })
      );
    }

    const files = output.trim().split("\n").filter((f) => f);
    const extensions: Record<string, number> = {};

    for (const file of files) {
      const ext = file.includes(".")
        ? file.split(".").pop() || "unknown"
        : "no-extension";
      extensions[ext] = (extensions[ext] || 0) + 1;
    }

    return { totalFiles: files.length, extensions };
  });

export const getTotalLines = (repoPath: string) =>
  Effect.gen(function* () {
    // Count lines in non-binary files using git grep
    const proc = Bun.spawn(["git", "grep", "-I", "-c", "$"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = yield* Effect.tryPromise(() => new Response(proc.stdout).text());
    yield* Effect.tryPromise(() => proc.exited);

    if ((proc.exitCode ?? 1) > 1) {
      // 0 = matches found, 1 = no matches found, >1 = error
      return yield* Effect.fail(
        new ConfigError({ message: "Failed to count lines" })
      );
    }

    let count = 0;
    const lines = output.trim().split("\n");
    for (const line of lines) {
      if (!line) continue;
      const lastColonIndex = line.lastIndexOf(":");
      if (lastColonIndex !== -1) {
        const num = parseInt(line.substring(lastColonIndex + 1));
        if (!isNaN(num)) {
          count += num;
        }
      }
    }
    return count;
  });

export const getTopContributors = (repoPath: string) =>
  Effect.gen(function* () {
    const proc = Bun.spawn(["git", "shortlog", "-sn", "--all"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = yield* Effect.tryPromise(() => new Response(proc.stdout).text());
    yield* Effect.tryPromise(() => proc.exited);

    if (proc.exitCode !== 0) {
      return yield* Effect.fail(
        new ConfigError({ message: "Failed to get contributors" })
      );
    }

    const contributors: Array<{ name: string; commits: number }> = [];
    const lines = output.trim().split("\n");

    for (const line of lines) {
      if (!line) continue;
      // Format: "   10  Name"
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (match && match[1] && match[2]) {
        contributors.push({
          commits: parseInt(match[1]),
          name: match[2],
        });
      }
    }

    return contributors.slice(0, 10); // Return top 10
  });
