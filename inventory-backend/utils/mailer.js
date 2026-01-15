// utils/mailer.js
import { Resend } from "resend";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const resend = new Resend(must("RESEND_API_KEY"));

export async function sendEmail({ to, subject, html, text }) {
  const from = must("EMAIL_FROM");

  const { error } = await resend.emails.send({
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
  });

  if (error) throw new Error(error.message || "Resend send failed");
}

console.log("RESEND KEY PRESENT:", !!process.env.RESEND_API_KEY);
console.log("EMAIL_FROM:", process.env.EMAIL_FROM);
