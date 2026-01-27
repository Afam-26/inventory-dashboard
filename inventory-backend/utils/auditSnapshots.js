// utils/auditSnapshots.js
import crypto from "crypto";
import { db as defaultDb } from "../config/db.js";

// Prefer a dedicated secret, fallback to AUDIT_HASH_SECRET
function requireSnapshotSecret() {
  const v =
    (process.env.AUDIT_SNAPSHOT_SECRET || "").trim() ||
    (process.env.AUDIT_HASH_SECRET || "").trim();
  if (!v) throw new Error("AUDIT_SNAPSHOT_SECRET (or AUDIT_HASH_SECRET) is not set");
  return v;
}

function hmacSha256Hex(secret, input) {
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

// ISO day boundaries (UTC) as strings (lexicographically comparable)
function dayBoundsUtc(dateStr /* YYYY-MM-DD */) {
  const startIso = `${dateStr}T00:00:00.000Z`;
  const end = new Date(`${dateStr}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endIso = end.toISOString();
  return { startIso, endIso };
}

async function listTenantIds(db) {
  const [rows] = await db.query("SELECT id FROM tenants ORDER BY id ASC");
  return rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Create/Upsert a daily snapshot for a tenant + date.
 * - dateStr is YYYY-MM-DD (UTC day)
 * - snapshot_hash is HMAC over (tenantId, date, end_row_hash, count, start_id, end_id, last_created_at_iso)
 */
export async function createDailySnapshot(db = defaultDb, { tenantId, dateStr }) {
  const secret = requireSnapshotSecret();
  const tid = Number(tenantId);
  if (!Number.isFinite(tid) || tid <= 0) throw new Error("createDailySnapshot: invalid tenantId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error("createDailySnapshot: invalid dateStr");

  const { startIso, endIso } = dayBoundsUtc(dateStr);

  const [rows] = await db.query(
    `
    SELECT id, created_at_iso, row_hash
    FROM audit_logs
    WHERE tenant_id = ?
      AND created_at_iso >= ?
      AND created_at_iso < ?
      AND row_hash IS NOT NULL
      AND created_at_iso IS NOT NULL
    ORDER BY id ASC
    `,
    [tid, startIso, endIso]
  );

  const count = rows.length;

  // Even if there are 0 events, we still create a snapshot hash for the day
  const startId = count ? rows[0].id : null;
  const endId = count ? rows[count - 1].id : null;
  const endRowHash = count ? rows[count - 1].row_hash : null;
  const lastCreatedAtIso = count ? rows[count - 1].created_at_iso : null;

  const material = [
    "snapshot-v1",
    `tenant=${tid}`,
    `date=${dateStr}`,
    `count=${count}`,
    `startId=${startId ?? ""}`,
    `endId=${endId ?? ""}`,
    `endRowHash=${endRowHash ?? ""}`,
    `lastCreatedAtIso=${lastCreatedAtIso ?? ""}`,
  ].join("|");

  const snapshotHash = hmacSha256Hex(secret, material);

  await db.query(
    `
    INSERT INTO audit_daily_snapshots
      (tenant_id, snapshot_date, start_id, end_id, end_row_hash, events_count, last_created_at_iso, snapshot_hash)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      start_id = VALUES(start_id),
      end_id = VALUES(end_id),
      end_row_hash = VALUES(end_row_hash),
      events_count = VALUES(events_count),
      last_created_at_iso = VALUES(last_created_at_iso),
      snapshot_hash = VALUES(snapshot_hash)
    `,
    [tid, dateStr, startId, endId, endRowHash, count, lastCreatedAtIso, snapshotHash]
  );

  return {
    ok: true,
    tenantId: tid,
    snapshotDate: dateStr,
    count,
    startId,
    endId,
    endRowHash,
    lastCreatedAtIso,
    snapshotHash,
  };
}

/**
 * Create snapshots for ALL tenants for the given dateStr (UTC).
 */
export async function createDailySnapshotsForAllTenants(db = defaultDb, { dateStr }) {
  const tenantIds = await listTenantIds(db);
  const results = [];
  for (const tenantId of tenantIds) {
    try {
      results.push(await createDailySnapshot(db, { tenantId, dateStr }));
    } catch (e) {
      results.push({
        ok: false,
        tenantId,
        snapshotDate: dateStr,
        error: e?.message || String(e),
      });
    }
  }
  return { ok: true, dateStr, results };
}

/**
 * Schedules a daily job WITHOUT cron dependency.
 * Default: run at 00:05 UTC and snapshot the PREVIOUS day.
 *
 * Call this once at server startup.
 */
export function scheduleDailySnapshots(db = defaultDb, { hourUtc = 0, minuteUtc = 5 } = {}) {
  function nextRunDelayMs() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hourUtc, minuteUtc, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  }

  async function runOnce() {
    const now = new Date();
    const y = new Date(now);
    y.setUTCDate(y.getUTCDate() - 1);
    const dateStr = y.toISOString().slice(0, 10); // YYYY-MM-DD

    try {
      const out = await createDailySnapshotsForAllTenants(db, { dateStr });
      console.log("AUDIT SNAPSHOT:", out.dateStr, "tenants:", out.results.length);
    } catch (e) {
      console.error("AUDIT SNAPSHOT ERROR:", e?.message || e);
    }
  }

  function scheduleNext() {
    const ms = nextRunDelayMs();
    setTimeout(async () => {
      await runOnce();
      scheduleNext();
    }, ms);
  }

  scheduleNext();
}
