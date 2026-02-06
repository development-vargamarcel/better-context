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

/**
 * Calculates file churn (modification frequency) for the repository.
 * @param repoPath Absolute path to the repository
 * @param limit Number of top churned files to return
 */
export const getChurn = (repoPath: string, limit: number = 10) =>
  Effect.gen(function* () {
    yield* Effect.logDebug(`Calculating churn for ${repoPath} (limit: ${limit})`);

    // git log --name-only --format=
    // This outputs the list of modified files for each commit, without commit info.
    const proc = Bun.spawn(["git", "log", "--name-only", "--format="], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = yield* Effect.tryPromise(() => new Response(proc.stdout).text());
    const stderr = yield* Effect.tryPromise(() => new Response(proc.stderr).text());
    yield* Effect.tryPromise(() => proc.exited);

    if (proc.exitCode !== 0) {
      yield* Effect.logError(`Failed to execute git log for churn stats: ${stderr}`);
      return yield* Effect.fail(
        new ConfigError({ message: "Failed to get churn stats" })
      );
    }

    const fileCounts: Record<string, number> = {};
    const lines = output.trim().split("\n");

    for (const line of lines) {
      if (!line) continue;
      fileCounts[line] = (fileCounts[line] || 0) + 1;
    }

    const sortedFiles = Object.entries(fileCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([file, count]) => ({ file, count }));

    return sortedFiles;
  });
