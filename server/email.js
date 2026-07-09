"use strict";

async function sendViaBrevo({ fromEmail, fromName, to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("BREVO_API_KEY is not set");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API ${response.status}: ${body}`);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendConfirmationEmail(
  payload,
  sessionDateFmt,
  joiningLink,
  sessionTime,
) {
  const senderEmail = process.env.SENDER_EMAIL;
  const senderName =
    process.env.SENDER_DISPLAY_NAME || "Manuka Honey Gentell Education Team";
  const location =
    process.env.SESSION_LOCATION ||
    "Venue details will be confirmed separately.";
  const isVirtual = payload.sessionFormat !== "in-person";
  const formatLabel =
    payload.sessionFormat === "in-person" ? "In-person" : "Virtual";

  const joiningLinkSection =
    isVirtual && joiningLink
      ? `
    <div style="margin-top:20px;">
      <p style="margin:0 0 10px;font-weight:700;font-size:15px;color:#212b32;">Virtual Joining Link</p>
      <a href="${escapeHtml(joiningLink)}"
         style="display:inline-block;background-color:#007f3b;color:#ffffff;text-decoration:none;
                padding:12px 24px;border-radius:4px;font-weight:700;font-size:15px;">
        Join Session
      </a>
      <p style="margin:10px 0 0;font-size:13px;color:#425563;word-break:break-all;">
        Or copy this link:
        <a href="${escapeHtml(joiningLink)}" style="color:#005eb8;">${escapeHtml(joiningLink)}</a>
      </p>
    </div>`
      : "";

  const locationRow = !isVirtual
    ? `
    <tr>
      <td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Location:</td>
      <td style="padding:5px 0;font-size:14px;">${escapeHtml(location)}</td>
    </tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Registration Confirmed</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,'Helvetica Neue',sans-serif;background-color:#f0f4f5;color:#212b32;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f0f4f5;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
               style="max-width:600px;background-color:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #d8dde0;">

          <tr>
            <td style="background-color:#005eb8;padding:24px 32px;">
              <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">
                Manuka Honey Gentell
              </h1>
              <p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">
                Education Session &mdash; Registration Confirmed
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">
                Dear ${escapeHtml(payload.fullName)},
              </p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">
                Thank you for registering for the
                <strong>Manuka Honey Gentell Education Session</strong>.
                Your place has been reserved.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                     style="background-color:#f0f4f5;border-left:4px solid #005eb8;
                            border-radius:0 4px 4px 0;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#005eb8;">
                      Your Session Details
                    </h2>
                    <table cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Date:</td>
                        <td style="padding:5px 0;font-size:14px;">${escapeHtml(sessionDateFmt)}</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Time:</td>
                        <td style="padding:5px 0;font-size:14px;">${escapeHtml(sessionTime)}</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Format:</td>
                        <td style="padding:5px 0;font-size:14px;">${escapeHtml(formatLabel)}</td>
                      </tr>
                      ${locationRow}
                    </table>
                    ${joiningLinkSection}
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#425563;">
                Please add this session to your calendar. If you are unable to attend,
                please let us know as soon as possible so your place can be offered to
                someone on the waiting list.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#425563;">
                If you have any questions, please reply to this email and a member of the
                education team will be in touch.
              </p>
              <p style="margin:0;font-size:16px;line-height:1.6;">
                We look forward to seeing you there.<br><br>
                Kind regards,<br>
                <strong>The Manuka Honey Gentell Education Team</strong>
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#425563;padding:18px 32px;">
              <p style="margin:0;font-size:12px;color:#d8dde0;line-height:1.5;">
                This is an automated confirmation email. Your personal data is processed
                in accordance with UK GDPR. If you have accessibility requirements we have
                not yet addressed, please contact us directly.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await sendViaBrevo({
    fromEmail: senderEmail,
    fromName: senderName,
    to: payload.email,
    subject: `Registration Confirmed \u2014 Manuka Honey Gentell: ${sessionDateFmt}`,
    text: `Thank you for registering for the Manuka Honey Gentell Education Session on ${sessionDateFmt}. Please view this email in an HTML-capable client for full details.`,
    html,
  });
}

async function sendOrganiserNotification(payload, sessionDateFmt) {
  const organiserEmail = process.env.ORGANISER_EMAIL;
  if (!organiserEmail) return;

  const senderEmail = process.env.SENDER_EMAIL;
  const senderName =
    process.env.SENDER_DISPLAY_NAME || "Manuka Honey Gentell Education Team";

  const row = (label, value) => `
    <tr>
      <td style="padding:8px 12px;border:1px solid #d8dde0;background-color:#f0f4f5;
                 font-weight:700;font-size:13px;width:40%;vertical-align:top;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:8px 12px;border:1px solid #d8dde0;font-size:13px;vertical-align:top;">
        ${escapeHtml(value)}
      </td>
    </tr>`;

  const tableRows = [
    row("Full Name", payload.fullName),
    row("Email", payload.email),
    row("Trust / Organisation", payload.trustOrganisation),
    row("Profession / Role", payload.professionRole),
    row("Department / Specialty", payload.departmentSpecialty || "\u2014"),
    row("Place of Work", payload.placeOfWork),
    row("Session Date", sessionDateFmt),
    row("Session Format", payload.sessionFormat || "Not specified"),
    row("Willing to be Contacted", payload.willingToBeContacted ? "Yes" : "No"),
    row("Phone Number", payload.contactPhoneNumber || "\u2014"),
    row(
      "Accessibility / Dietary",
      payload.accessibilityRequirements || "\u2014",
    ),
    row("How Did They Hear", payload.howDidYouHear || "\u2014"),
    row(
      "Submitted At",
      new Date().toLocaleString("en-GB", { timeZone: "Europe/London" }),
    ),
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>New Registration</title></head>
<body style="font-family:Arial,sans-serif;color:#212b32;padding:20px;">
  <h2 style="color:#005eb8;">New Registration &mdash; Manuka Honey Gentell</h2>
  <p style="color:#425563;margin-bottom:16px;">
    A new registration has been submitted. Details are shown below.
  </p>
  <table cellpadding="0" cellspacing="0"
         style="border-collapse:collapse;width:100%;max-width:600px;">
    ${tableRows}
  </table>
</body>
</html>`;

  await sendViaBrevo({
    fromEmail: senderEmail,
    fromName: senderName,
    to: organiserEmail,
    subject: `New Registration: ${payload.fullName} \u2014 ${sessionDateFmt}`,
    text: `${payload.fullName} has registered for the session on ${sessionDateFmt}.`,
    html,
  });
}

module.exports = { sendConfirmationEmail, sendOrganiserNotification };
