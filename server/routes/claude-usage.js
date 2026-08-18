/**
 * @file claude-usage.js
 * @description GET /api/claude-usage — reads the local "Claude Usage" macOS menu bar
 * app's snapshot history (github.com/HamedElfayome, installed via
 * `brew install --cask claude-usage-tracker`) and surfaces the current 5-hour
 * rolling session limit and weekly limit as JSON for the dashboard UI.
 *
 * That app already authenticates against the account's real plan limits and
 * writes periodic snapshots to
 * `~/Library/Application Support/Claude Usage/history/*.json` — this route just
 * parses the newest file and picks the latest usable `sessionReset` and
 * `weeklyReset` entries. Timestamps in that file are Mac absolute time (seconds
 * since 2001-01-01T00:00:00Z), converted here to unix milliseconds.
 *
 * A snapshot written right after the source app (re)starts or a reset fires has
 * `triggeringResetTime` equal to its own `timestamp` (the real reset time hasn't
 * been fetched yet) — those are skipped in favor of the next snapshot that carries
 * a real future reset time, falling back to the raw latest snapshot if none exists.
 *
 * Best-effort and read-only: this data lives outside `~/.claude`, is macOS-only,
 * and depends on a third-party app the user may not have running. Any failure
 * (missing app, missing file, unreadable JSON) resolves to `{ available: false }`
 * rather than throwing, so a machine/session without it never breaks the API.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");

const router = Router();

const HISTORY_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Claude Usage",
  "history"
);

// Mac absolute time epoch (2001-01-01T00:00:00Z) as a unix-ms offset.
const MAC_EPOCH_OFFSET_MS = Date.UTC(2001, 0, 1);

function macTimeToUnixMs(macSeconds) {
  if (typeof macSeconds !== "number" || !Number.isFinite(macSeconds)) return null;
  return MAC_EPOCH_OFFSET_MS + macSeconds * 1000;
}

// A snapshot written immediately after (re)start/reset hasn't fetched a real
// reset time yet — its triggeringResetTime is just its own timestamp.
function hasRealResetTime(snapshot) {
  const delta = Math.abs((snapshot.triggeringResetTime ?? 0) - (snapshot.timestamp ?? 0));
  return delta > 1;
}

function latestSnapshot(snapshots, resetType) {
  const matches = snapshots
    .filter((s) => s.resetType === resetType)
    .sort((a, b) => b.timestamp - a.timestamp);
  if (matches.length === 0) return null;
  return matches.find(hasRealResetTime) ?? matches[0];
}

function newestHistoryFile() {
  let entries;
  try {
    entries = fs.readdirSync(HISTORY_DIR, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => {
      const full = path.join(HISTORY_DIR, e.name);
      try {
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.full ?? null;
}

function readUsage() {
  const file = newestHistoryFile();
  if (!file) return { available: false };

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { available: false };
  }

  const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
  const session = latestSnapshot(snapshots, "sessionReset");
  const weekly = latestSnapshot(snapshots, "weeklyReset");
  if (!session && !weekly) return { available: false };

  return {
    available: true,
    session: session
      ? {
          percentage: session.sessionPercentage ?? null,
          tokensUsed: session.sessionTokensUsed ?? null,
          resetsAt: hasRealResetTime(session) ? macTimeToUnixMs(session.triggeringResetTime) : null,
          asOf: macTimeToUnixMs(session.timestamp),
        }
      : null,
    weekly: weekly
      ? {
          percentage: weekly.weeklyPercentage ?? null,
          tokensUsed: weekly.weeklyTokensUsed ?? null,
          opusPercentage: weekly.opusWeeklyPercentage ?? null,
          sonnetPercentage: weekly.sonnetWeeklyPercentage ?? null,
          resetsAt: hasRealResetTime(weekly) ? macTimeToUnixMs(weekly.triggeringResetTime) : null,
          asOf: macTimeToUnixMs(weekly.timestamp),
        }
      : null,
  };
}

router.get("/", (_req, res) => {
  res.json(readUsage());
});

module.exports = router;
