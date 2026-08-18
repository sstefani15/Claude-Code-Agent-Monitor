/**
 * @file ClaudeUsageWidget.tsx
 * @description Compact sidebar widget showing the account's 5-hour rolling
 * session limit and weekly limit, sourced from `GET /api/claude-usage` (see
 * `server/routes/claude-usage.js`). Polls on a 30s interval — this data only
 * changes when the user is actively burning tokens, so anything faster is
 * unnecessary chatter for what's ultimately a local file read.
 *
 * Renders nothing (not an empty state — literally nothing) when the source
 * "Claude Usage" app isn't installed/running, so a machine without it never
 * shows a broken or empty widget in the footer.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { api } from "../lib/api";
import type { ClaudeUsageResponse } from "../lib/api";
import { formatMs } from "../lib/format";

const POLL_INTERVAL_MS = 30_000;

function severityClasses(pct: number | null): { bar: string; text: string } {
  if (pct === null) return { bar: "bg-gray-500", text: "text-gray-400" };
  if (pct >= 90) return { bar: "bg-red-400", text: "text-red-400" };
  if (pct >= 70) return { bar: "bg-amber-400", text: "text-amber-400" };
  return { bar: "bg-emerald-400", text: "text-emerald-400" };
}

function resetLabel(resetsAt: number | null): string | null {
  if (resetsAt === null) return null;
  const remaining = resetsAt - Date.now();
  if (remaining <= 0) return "resetting…";
  return `resets in ${formatMs(remaining)}`;
}

function UsageBar({
  label,
  pct,
  reset,
}: {
  label: string;
  pct: number | null;
  reset: string | null;
}) {
  const { bar, text } = severityClasses(pct);
  return (
    <div className="text-[11px]">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-medium text-gray-300">{label}</span>
        <span className={`font-mono font-semibold ${text}`}>{pct === null ? "—" : `${pct}%`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${bar}`}
          style={{ width: `${Math.max(2, Math.min(100, pct ?? 0))}%` }}
        />
      </div>
      {reset && <div className="mt-0.5 text-[10px] text-gray-500">{reset}</div>}
    </div>
  );
}

/** Renders nothing when {@link collapsed} is true — matches the other
 *  text-bearing footer items in {@link Sidebar}, which hide rather than
 *  shrink to an icon. */
export function ClaudeUsageWidget({ collapsed }: { collapsed: boolean }) {
  const [usage, setUsage] = useState<ClaudeUsageResponse | null>(null);
  // Ticks once a second purely to re-render the "resets in Xh Ym" countdown
  // between polls — the underlying data only refreshes every 30s.
  const [, forceTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.claudeUsage
        .get()
        .then((res) => {
          if (!cancelled) setUsage(res);
        })
        .catch(() => {
          if (!cancelled) setUsage({ available: false, session: null, weekly: null });
        });
    };
    load();
    const pollId = window.setInterval(load, POLL_INTERVAL_MS);
    const tickId = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, []);

  if (collapsed || !usage?.available) return null;

  return (
    <div className="rounded-lg border border-border bg-surface-2 px-2.5 py-2 space-y-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        <Gauge className="w-3 h-3 flex-shrink-0" aria-hidden />
        Claude usage
      </div>
      <UsageBar
        label="5h session"
        pct={usage.session?.percentage ?? null}
        reset={resetLabel(usage.session?.resetsAt ?? null)}
      />
      <UsageBar
        label="Weekly"
        pct={usage.weekly?.percentage ?? null}
        reset={resetLabel(usage.weekly?.resetsAt ?? null)}
      />
    </div>
  );
}
