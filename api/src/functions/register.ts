import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

// ============================================================
// Types
// ============================================================

interface RegistrationPayload {
  fullName: string;
  email: string;
  trustOrganisation: string;
  professionRole: string;
  departmentSpecialty?: string;
  placeOfWork: string;
  preferredSessionDate: string;
  sessionFormat?: string;
  willingToBeContacted: boolean;
  contactPhoneNumber?: string;
  accessibilityRequirements?: string;
  howDidYouHear?: string;
  gdprConsent: boolean;
}

interface TokenResponse {
  access_token: string;
}

interface GraphListResponse {
  value: unknown[];
}

// ============================================================
// Rate limiting — in-memory, resets on cold start.
// For multi-instance deployments consider Azure API Management
// or Azure Front Door WAF for reliable rate limiting.
// ============================================================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX         = 5;
const RATE_LIMIT_WINDOW_MS   = 15 * 60 * 1000; // 15 minutes
const MAX_RATE_LIMIT_ENTRIES = 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Prevent unbounded memory growth
  if (rateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) {
    for (const [key, entry] of rateLimitMap.entries()) {
      if (now > entry.resetAt) rateLimitMap.delete(key);
    }
    if (rateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) rateLimitMap.clear();
  }

  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ============================================================
// Utility helpers
// ============================================================

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Strip angle brackets and trim to max length to prevent XSS/injection. */
function sanitize(input: string | undefined, maxLength = 500): string {
  if (!input) return "";
  return input.replace(/[<>]/g, "").trim().substring(0, maxLength);
}

/** Escape characters that are special in HTML contexts. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================
// Input validation
// ============================================================

function validatePayload(body: unknown): { valid: boolean; errors: string[]; honeypot: boolean } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, errors: ["Invalid request body."], honeypot: false };
  }

  const p = body as Record<string, unknown>;

  // Honeypot check — silently succeed to confuse bots
  if (typeof p.honeypot === "string" && p.honeypot.trim() !== "") {
    return { valid: false, errors: [], honeypot: true };
  }

  const errors: string[] = [];

  if (!p.fullName || typeof p.fullName !== "string" || p.fullName.trim().length < 2) {
    errors.push("Full name is required (minimum 2 characters).");
  }

  if (!p.email || typeof p.email !== "string") {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((p.email as string).trim())) {
    errors.push("A valid email address is required.");
  }

  if (!p.trustOrganisation || typeof p.trustOrganisation !== "string" || !p.trustOrganisation.trim()) {
    errors.push("Trust or organisation is required.");
  }

  if (!p.professionRole || typeof p.professionRole !== "string" || !p.professionRole.trim()) {
    errors.push("Profession or role is required.");
  }

  if (!p.placeOfWork || typeof p.placeOfWork !== "string" || !p.placeOfWork.trim()) {
    errors.push("Place of work is required.");
  }

  const validDates = ["15-July", "21-July", "23-July"];
  if (!p.preferredSessionDate || !validDates.includes(p.preferredSessionDate as string)) {
    errors.push("A valid preferred session date must be selected.");
  }

  if (
    p.sessionFormat !== undefined &&
    p.sessionFormat !== "" &&
    !["in-person", "virtual"].includes(p.sessionFormat as string)
  ) {
    errors.push("Invalid session format value.");
  }

  if (typeof p.willingToBeContacted !== "boolean") {
    errors.push("Please indicate whether you are willing to be contacted for further education.");
  }

  if (p.contactPhoneNumber && typeof p.contactPhoneNumber === "string") {
    const phone = p.contactPhoneNumber.trim();
    if (phone.length > 0 && !/^[\d\s+\-()\[\]]{7,20}$/.test(phone)) {
      errors.push("Invalid phone number format.");
    }
  }

  if (p.gdprConsent !== true) {
    errors.push("GDPR consent is required.");
  }

  // Enforce field length limits
  const lengthLimits: Array<[string, number]> = [
    ["fullName", 200],
    ["email", 254],
    ["trustOrganisation", 200],
    ["professionRole", 100],
    ["departmentSpecialty", 200],
    ["placeOfWork", 200],
    ["contactPhoneNumber", 50],
    ["accessibilityRequirements", 500],
    ["howDidYouHear", 200],
  ];

  for (const [field, limit] of lengthLimits) {
    if (typeof p[field] === "string" && (p[field] as string).length > limit) {
      errors.push(`Field "${field}" exceeds the maximum allowed length.`);
    }
  }

  return { valid: errors.length === 0, errors, honeypot: false };
}

// ============================================================
// Microsoft Graph API — authentication
// ============================================================

async function getAccessToken(): Promise<string> {
  const tenantId     = getRequiredEnv("AZURE_TENANT_ID");
  const clientId     = getRequiredEnv("AZURE_CLIENT_ID");
  const clientSecret = getRequiredEnv("AZURE_CLIENT_SECRET");

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         "https://graph.microsoft.com/.default",
    grant_type:    "client_credentials",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Graph authentication failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as TokenResponse;
  return data.access_token;
}

// ============================================================
// Microsoft Graph API — SharePoint
// ============================================================

async function checkDuplicate(
  token: string,
  email: string,
  sessionDate: string
): Promise<boolean> {
  const siteId = getRequiredEnv("SHAREPOINT_SITE_ID");
  const listId = getRequiredEnv("SHAREPOINT_LIST_ID");

  const filter = `fields/EmailAddress eq '${email}' and fields/PreferredSessionDate eq '${sessionDate}'`;
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items` +
    `?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    // If we cannot check for duplicates, do not block the registration.
    return false;
  }

  const data = (await response.json()) as GraphListResponse;
  return data.value.length > 0;
}

async function writeToSharePoint(
  token: string,
  payload: RegistrationPayload
): Promise<void> {
  const siteId = getRequiredEnv("SHAREPOINT_SITE_ID");
  const listId = getRequiredEnv("SHAREPOINT_LIST_ID");

  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`;

  const body = {
    fields: {
      Title:                    payload.fullName,
      EmailAddress:             payload.email,
      TrustOrganisation:        payload.trustOrganisation,
      ProfessionRole:           payload.professionRole,
      DepartmentSpecialty:      payload.departmentSpecialty ?? "",
      PlaceOfWork:              payload.placeOfWork,
      PreferredSessionDate:     payload.preferredSessionDate,
      SessionFormat:            payload.sessionFormat ?? "",
      WillingToBeContacted:     payload.willingToBeContacted,
      ContactPhoneNumber:       payload.contactPhoneNumber ?? "",
      AccessibilityRequirements: payload.accessibilityRequirements ?? "",
      HowDidYouHear:            payload.howDidYouHear ?? "",
      GDPRConsent:              payload.gdprConsent,
      SubmittedAt:              new Date().toISOString(),
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to write to SharePoint: HTTP ${response.status} — ${detail}`);
  }
}

// ============================================================
// Session metadata helpers
// ============================================================

function getJoiningLink(sessionDate: string): string {
  const map: Record<string, string | undefined> = {
    "15-July": process.env.JOINING_LINK_15_JULY,
    "21-July": process.env.JOINING_LINK_21_JULY,
    "23-July": process.env.JOINING_LINK_23_JULY,
  };
  return map[sessionDate] ?? "";
}

function getSessionTime(sessionDate: string): string {
  const map: Record<string, string | undefined> = {
    "15-July": process.env.SESSION_TIME_15_JULY,
    "21-July": process.env.SESSION_TIME_21_JULY,
    "23-July": process.env.SESSION_TIME_23_JULY,
  };
  return map[sessionDate] ?? "Time to be confirmed";
}

function formatSessionDate(sessionDate: string): string {
  const isoMap: Record<string, string> = {
    "15-July": "2026-07-15",
    "21-July": "2026-07-21",
    "23-July": "2026-07-23",
  };
  const iso = isoMap[sessionDate];
  if (!iso) return sessionDate;

  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/London",
    });
  } catch {
    return iso;
  }
}

// ============================================================
// Email helpers
// ============================================================

async function sendConfirmationEmail(
  token: string,
  payload: RegistrationPayload,
  joiningLink: string,
  sessionTime: string
): Promise<void> {
  const senderEmail         = getRequiredEnv("SENDER_EMAIL");
  const sessionDateFormatted = formatSessionDate(payload.preferredSessionDate);
  const isVirtual           = payload.sessionFormat !== "in-person";
  const sessionLocation     = process.env.SESSION_LOCATION ?? "Venue details will be confirmed separately.";

  const safeName    = escapeHtml(payload.fullName);
  const safeDate    = escapeHtml(sessionDateFormatted);
  const safeTime    = escapeHtml(sessionTime);
  const safeLink    = escapeHtml(joiningLink);
  const safeLocation = escapeHtml(sessionLocation);

  const joiningLinkSection =
    isVirtual && joiningLink
      ? `<div style="margin-top:20px;">
           <p style="margin:0 0 10px;font-weight:700;font-size:15px;color:#212b32;">Virtual Joining Link</p>
           <a href="${safeLink}"
              style="display:inline-block;background-color:#007f3b;color:#ffffff;text-decoration:none;
                     padding:12px 24px;border-radius:4px;font-weight:700;font-size:15px;">
             Join Microsoft Teams Meeting
           </a>
           <p style="margin:10px 0 0;font-size:13px;color:#425563;word-break:break-all;">
             Or copy this link: <a href="${safeLink}" style="color:#005eb8;">${safeLink}</a>
           </p>
         </div>`
      : "";

  const locationRow =
    !isVirtual
      ? `<tr>
           <td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Location:</td>
           <td style="padding:5px 0;font-size:14px;">${safeLocation}</td>
         </tr>`
      : "";

  const formatLabel = payload.sessionFormat === "in-person"
    ? "In-person"
    : "Virtual (Microsoft Teams)";

  const emailHtml = `<!DOCTYPE html>
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

          <!-- Header -->
          <tr>
            <td style="background-color:#005eb8;padding:24px 32px;">
              <h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">
                Manuka Honey Gentell
              </h1>
              <p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">
                Education Session — Registration Confirmed
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Dear ${safeName},</p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">
                Thank you for registering for the
                <strong>Manuka Honey Gentell Education Session</strong>.
                Your place has been reserved.
              </p>

              <!-- Session detail box -->
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
                        <td style="padding:5px 0;font-size:14px;">${safeDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Time:</td>
                        <td style="padding:5px 0;font-size:14px;">${safeTime}</td>
                      </tr>
                      <tr>
                        <td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Format:</td>
                        <td style="padding:5px 0;font-size:14px;">${formatLabel}</td>
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

          <!-- Footer -->
          <tr>
            <td style="background-color:#425563;padding:18px 32px;">
              <p style="margin:0;font-size:12px;color:#d8dde0;line-height:1.5;">
                This is an automated confirmation email. Your personal data is processed
                in accordance with UK GDPR. If you have accessibility requirements we
                have not yet addressed, please contact us directly.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const emailPayload = {
    message: {
      subject: `Registration Confirmed \u2014 Manuka Honey Gentell: ${sessionDateFormatted}`,
      body: { contentType: "HTML", content: emailHtml },
      toRecipients: [{ emailAddress: { address: payload.email } }],
    },
    saveToSentItems: true,
  };

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`sendMail (confirmation) failed: HTTP ${response.status} — ${detail}`);
  }
}

async function sendOrganiserNotification(
  token: string,
  payload: RegistrationPayload
): Promise<void> {
  const senderEmail   = process.env.SENDER_EMAIL;
  const organiserEmail = process.env.ORGANISER_EMAIL;
  if (!senderEmail || !organiserEmail) return;

  const sessionDateFormatted = formatSessionDate(payload.preferredSessionDate);

  const row = (label: string, value: string): string =>
    `<tr>
      <td style="padding:8px 12px;border:1px solid #d8dde0;background-color:#f0f4f5;
                 font-weight:700;font-size:13px;width:40%;vertical-align:top;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:8px 12px;border:1px solid #d8dde0;font-size:13px;vertical-align:top;">
        ${escapeHtml(value)}
      </td>
    </tr>`;

  const tableRows = [
    row("Full Name",              payload.fullName),
    row("Email",                  payload.email),
    row("Trust / Organisation",   payload.trustOrganisation),
    row("Profession / Role",      payload.professionRole),
    row("Department / Specialty", payload.departmentSpecialty ?? "—"),
    row("Place of Work",          payload.placeOfWork),
    row("Session Date",           sessionDateFormatted),
    row("Session Format",         payload.sessionFormat ?? "Not specified"),
    row("Willing to be Contacted", payload.willingToBeContacted ? "Yes" : "No"),
    row("Phone Number",           payload.contactPhoneNumber ?? "—"),
    row("Accessibility / Dietary", payload.accessibilityRequirements ?? "—"),
    row("How Did They Hear",      payload.howDidYouHear ?? "—"),
    row("Submitted At",           new Date().toLocaleString("en-GB", { timeZone: "Europe/London" })),
  ].join("\n");

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>New Registration</title></head>
<body style="font-family:Arial,sans-serif;color:#212b32;padding:20px;">
  <h2 style="color:#005eb8;">New Registration — Manuka Honey Gentell</h2>
  <p style="color:#425563;margin-bottom:16px;">
    A new registration has been submitted. Details are shown below.
  </p>
  <table cellpadding="0" cellspacing="0"
         style="border-collapse:collapse;width:100%;max-width:600px;">
    ${tableRows}
  </table>
</body>
</html>`;

  const emailPayload = {
    message: {
      subject: `New Registration: ${payload.fullName} \u2014 ${sessionDateFormatted}`,
      body: { contentType: "HTML", content: emailHtml },
      toRecipients: [{ emailAddress: { address: organiserEmail } }],
    },
    saveToSentItems: false,
  };

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    }
  );

  if (!response.ok) {
    throw new Error(`sendMail (organiser) failed: HTTP ${response.status}`);
  }
}

// ============================================================
// Azure Function handler
// ============================================================

app.http("register", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "register",
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
    const headers: Record<string, string> = {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // CORS preflight
    if (request.method === "OPTIONS") {
      return { status: 204, headers };
    }

    // ── Rate limiting ──────────────────────────────────────────
    const forwardedFor =
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const clientIp = forwardedFor.split(",")[0].trim();

    if (!checkRateLimit(clientIp)) {
      return {
        status: 429,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Too many requests. Please wait a few minutes before trying again.",
        }),
      };
    }

    // ── Parse body ─────────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return {
        status: 400,
        headers,
        body: JSON.stringify({ success: false, message: "Invalid request body." }),
      };
    }

    // ── Validate ───────────────────────────────────────────────
    const { valid, errors, honeypot } = validatePayload(body);

    if (honeypot) {
      // Return fake success — don't reveal to bots that they were caught
      context.log("Honeypot triggered — discarding submission.");
      return {
        status: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };
    }

    if (!valid) {
      return {
        status: 400,
        headers,
        body: JSON.stringify({ success: false, message: "Validation failed.", errors }),
      };
    }

    // ── Build sanitised payload ────────────────────────────────
    const p = body as Record<string, unknown>;
    const payload: RegistrationPayload = {
      fullName:                  sanitize(p.fullName as string, 200),
      email:                     (p.email as string).trim().toLowerCase().substring(0, 254),
      trustOrganisation:         sanitize(p.trustOrganisation as string, 200),
      professionRole:            sanitize(p.professionRole as string, 100),
      departmentSpecialty:       sanitize(p.departmentSpecialty as string | undefined, 200) || undefined,
      placeOfWork:               sanitize(p.placeOfWork as string, 200),
      preferredSessionDate:      p.preferredSessionDate as string,
      sessionFormat:             p.sessionFormat as string | undefined,
      willingToBeContacted:      p.willingToBeContacted as boolean,
      contactPhoneNumber:        sanitize(p.contactPhoneNumber as string | undefined, 50) || undefined,
      accessibilityRequirements: sanitize(p.accessibilityRequirements as string | undefined, 500) || undefined,
      howDidYouHear:             sanitize(p.howDidYouHear as string | undefined, 200) || undefined,
      gdprConsent:               true,
    };

    try {
      // ── Authenticate with Graph API ────────────────────────────
      const token = await getAccessToken();

      // ── Duplicate check ────────────────────────────────────────
      const isDuplicate = await checkDuplicate(token, payload.email, payload.preferredSessionDate);
      if (isDuplicate) {
        return {
          status: 409,
          headers,
          body: JSON.stringify({
            success: false,
            message:
              "It looks like you have already registered for this session with this email address. " +
              "If you believe this is an error, please contact the education team.",
          }),
        };
      }

      // ── Write to SharePoint ────────────────────────────────────
      await writeToSharePoint(token, payload);

      // ── Confirmation email (non-fatal if it fails) ─────────────
      const joiningLink          = getJoiningLink(payload.preferredSessionDate);
      const sessionTime          = getSessionTime(payload.preferredSessionDate);
      const sessionDateFormatted = formatSessionDate(payload.preferredSessionDate);

      try {
        await sendConfirmationEmail(token, payload, joiningLink, sessionTime);
      } catch (emailErr) {
        context.error(
          "Confirmation email failed — registration was still saved.",
          emailErr
        );
      }

      // ── Organiser notification (best-effort, fire-and-forget) ──
      sendOrganiserNotification(token, payload).catch((err) =>
        context.error("Organiser notification failed:", err)
      );

      return {
        status: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: "Registration successful.",
          sessionDate: sessionDateFormatted,
        }),
      };
    } catch (err) {
      context.error("Unhandled registration error:", err);
      return {
        status: 500,
        headers,
        body: JSON.stringify({
          success: false,
          message:
            "An error occurred while processing your registration. " +
            "Please try again or contact the education team if the problem persists.",
        }),
      };
    }
  },
});
