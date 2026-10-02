// Transactional email via Resend's HTTP API (free tier: 3,000 emails / month).
// Without RESEND_API_KEY (local development) the email is printed to the console instead.
const FROM = process.env.MAIL_FROM || 'Starsplit <onboarding@resend.dev>';

async function sendMail({ to, subject, text, html }) {
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV !== 'test') console.log(`\n[mail] to ${to}: ${subject}\n${text}\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, text, html }),
  });
  if (!res.ok) console.error('[mail] send failed', res.status, await res.text().catch(() => ''));
}

module.exports = { sendMail };
