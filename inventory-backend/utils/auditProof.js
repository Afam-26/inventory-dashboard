// utils/auditProof.js
import crypto from "crypto";

function requireProofSecret() {
  const v =
    (process.env.AUDIT_PROOF_SECRET || "").trim() ||
    (process.env.AUDIT_HASH_SECRET || "").trim();

  if (!v) throw new Error("AUDIT_PROOF_SECRET (or AUDIT_HASH_SECRET) is not set");
  return v;
}

export function hmacHex(input) {
  const secret = requireProofSecret();
  return crypto.createHmac("sha256", secret).update(String(input)).digest("hex");
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${entries.join(",")}}`;
}

// UTC day bounds
function dayBoundsUtc(dateStr) {
  const startIso = `${dateStr}T00:00:00.000Z`;
  const end = new Date(`${dateStr}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso, endIso: end.toISOString() };
}

function normalizeRow(r) {
  // Only include fields that matter + are stable
  return {
    id: Number(r.id),
    tenant_id: Number(r.tenant_id),
    user_id: r.user_id == null ? null : Number(r.user_id),
    user_email: r.user_email ?? null,
    action: r.action ?? null,
    entity_type: r.entity_type ?? null,
    entity_id: r.entity_id == null ? null : Number(r.entity_id),
    details: r.details ?? null,
    ip_address: r.ip_address ?? null,
    user_agent: r.user_agent ?? null,
    prev_hash: r.prev_hash ?? null,
    row_hash: r.row_hash ?? null,
    created_at_iso: r.created_at_iso ?? null,
  };
}

/**
 * rowsRoot:
 * - deterministic Merkle-ish root based on per-row digest
 * - per-row digest = sha256(stableStringify(normalizedRow))
 * - root = sha256(d1|d2|...|dn)
 */
function computeRowsRoot(rows) {
  const digests = rows.map((r) => sha256Hex(stableStringify(r)));
  return sha256Hex(digests.join("|"));
}

async function loadSnapshot(db, { tenantId, dateStr }) {
  const [[snap]] = await db.query(
    `
    SELECT tenant_id, snapshot_date, start_id, end_id, end_row_hash,
           events_count, last_created_at_iso, snapshot_hash, created_at
    FROM audit_daily_snapshots
    WHERE tenant_id = ?
      AND snapshot_date = ?
    LIMIT 1
    `,
    [Number(tenantId), dateStr]
  );
  return snap || null;
}

export async function buildAuditProofBundle(db, { tenantId, date = null, fromId = null, toId = null } = {}) {
  if (!tenantId) throw new Error("tenantId required");

  const generatedAtIso = new Date().toISOString();

  let where = `WHERE tenant_id = ? AND row_hash IS NOT NULL AND created_at_iso IS NOT NULL`;
  const params = [Number(tenantId)];

  let mode = null;
  let snapshot = null;

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
    const { startIso, endIso } = dayBoundsUtc(date);
    where += ` AND created_at_iso >= ? AND created_at_iso < ?`;
    params.push(startIso, endIso);
    mode = "date";
    snapshot = await loadSnapshot(db, { tenantId, dateStr: date });
  } else if (fromId != null && toId != null) {
    mode = "range";
    where += ` AND id >= ? AND id <= ?`;
    params.push(Number(fromId), Number(toId));
  } else {
    throw new Error("Provide either date=YYYY-MM-DD or fromId & toId");
  }

  const [rowsRaw] = await db.query(
    `
    SELECT id, tenant_id, user_id, user_email, action, entity_type, entity_id,
           details, ip_address, user_agent, prev_hash, row_hash, created_at_iso
    FROM audit_logs
    ${where}
    ORDER BY id ASC
    `,
    params
  );

  const rows = rowsRaw.map(normalizeRow);

  const count = rows.length;
  const startId = count ? rows[0].id : null;
  const endId = count ? rows[count - 1].id : null;
  const startPrevHash = count ? rows[0].prev_hash : null;
  const endRowHash = count ? rows[count - 1].row_hash : null;
  const lastCreatedAtIso = count ? rows[count - 1].created_at_iso : null;

  const rowsRoot = computeRowsRoot(rows);

  const summary = {
    tenantId: Number(tenantId),
    mode,
    date: date || null,
    fromId: fromId ?? null,
    toId: toId ?? null,
    count,
    startId,
    endId,
    startPrevHash,
    endRowHash,
    lastCreatedAtIso,
  };

  const bundleMaterial = stableStringify({
    v: "proof-v1",
    generatedAtIso,
    summary,
    snapshot,     // can be null
    rowsRoot,
  });

  const bundleHash = hmacHex(bundleMaterial);

  return {
    v: "proof-v1",
    generatedAtIso,
    summary,
    snapshot,
    rowsRoot,
    bundleHash,
    rows,
  };
}

export function verifyAuditProofBundle(bundle) {
  if (!bundle || bundle.v !== "proof-v1") {
    return { ok: false, reason: "Invalid bundle format" };
  }

  const { generatedAtIso, summary, snapshot, rowsRoot, bundleHash, rows } = bundle;

  // recompute rowsRoot
  const recomputedRoot = computeRowsRoot((rows || []).map((r) => normalizeRow(r)));
  if (recomputedRoot !== rowsRoot) {
    return { ok: false, reason: "rowsRoot mismatch" };
  }

  const material = stableStringify({
    v: "proof-v1",
    generatedAtIso,
    summary,
    snapshot,
    rowsRoot,
  });

  const expected = hmacHex(material);
  if (expected !== bundleHash) {
    return { ok: false, reason: "bundleHash mismatch" };
  }

  return { ok: true };
}
