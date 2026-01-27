// jobs/auditSnapshotJob.js
import { createDailyAuditSnapshot } from "../utils/auditSnapshot.js";
import { db } from "../config/db.js";

/**
 * Runs daily at a chosen hour/minute (server time).
 * In Railway, you may prefer Railway Cron instead — but this works anywhere.
 */
function msUntilNextRun(hour = 0, minute = 10) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function runSnapshotsForAllTenants() {
  const [tenants] = await db.query(`SELECT id FROM tenants WHERE status='active' OR status IS NULL`);
  for (const t of tenants) {
    try {
      await createDailyAuditSnapshot(db, { tenantId: t.id });
      console.log(`AUDIT SNAPSHOT: tenant ${t.id} OK`);
    } catch (e) {
      console.error(`AUDIT SNAPSHOT: tenant ${t.id} FAILED`, e?.message || e);
    }
  }
}

export function startAuditSnapshotJob() {
  const hour = Number(process.env.AUDIT_SNAPSHOT_HOUR ?? 0);
  const minute = Number(process.env.AUDIT_SNAPSHOT_MINUTE ?? 10);

  const scheduleNext = () => {
    const wait = msUntilNextRun(hour, minute);
    setTimeout(async () => {
      try {
        await runSnapshotsForAllTenants();
      } catch (e) {
        console.error("AUDIT SNAPSHOT JOB ERROR:", e?.message || e);
      } finally {
        scheduleNext();
      }
    }, wait);
  };

  scheduleNext();
  console.log(`AUDIT SNAPSHOT JOB: scheduled daily at ${hour}:${String(minute).padStart(2, "0")}`);
}
