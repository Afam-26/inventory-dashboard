// utils/alertRouting.js
export async function getAdminAlertTargets(db, severity) {
  // assumes users.role='admin'
  const { rows } = await db.query(
    `
    SELECT u.email,
           COALESCE(p.email_enabled, true) AS email_enabled,
           COALESCE(p.slack_enabled, true) AS slack_enabled,
           COALESCE(p.security_only, true) AS security_only,
           COALESCE(p.min_severity, 2) AS min_severity
    FROM users u
    LEFT JOIN admin_alert_prefs p ON p.admin_user_id = u.id
    WHERE u.role = 'admin'
    `
  );

  // filter by severity
  return rows.filter(r => severity >= Number(r.min_severity));
}
