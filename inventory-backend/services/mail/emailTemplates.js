// utils/emailTemplates.js

export function passwordResetEmail({ resetLink, minutes = 30 }) {
  const subject = "Reset your password";

  const text =
    `Reset your password using this link (expires in ${minutes} minutes):\n` +
    `${resetLink}\n\n` +
    `If you didn't request this, you can ignore this email.`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 10px;">Password reset</h2>
      <p style="margin: 0 0 12px;">
        Click the button below to reset your password. This link expires in ${minutes} minutes.
      </p>
      <p style="margin: 16px 0;">
        <a href="${resetLink}"
           style="display:inline-block;padding:10px 14px;border-radius:10px;background:#111827;color:#fff;text-decoration:none;">
          Reset password
        </a>
      </p>
      <p style="margin: 12px 0 0; font-size: 13px; color: #444;">
        If you did not request this, you can ignore this email.
      </p>
    </div>
  `;

  return { subject, html, text };
}
