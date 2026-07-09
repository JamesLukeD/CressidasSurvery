// ============================================================
// CONFIGURATION — edit these values before deploying
// ============================================================

/** ID of the Google Sheet to write registrations into.
 *  Found in the sheet URL: docs.google.com/spreadsheets/d/SHEET_ID/edit */
var SHEET_ID = "YOUR_GOOGLE_SHEET_ID";

/** Name of the sheet tab to write registrations to */
var SHEET_NAME = "Registrations";

/** Email address that receives organiser notifications */
var ORGANISER_EMAIL = "you@example.com";

/** Display name shown in the From field of all outgoing emails */
var SENDER_DISPLAY_NAME = "Manuka Honey Gentell Education Team";

/** Location text shown for in-person sessions */
var SESSION_LOCATION = "Venue details will be confirmed separately.";

/** Per-session configuration — fill in times and Teams/Zoom links */
var SESSION_CONFIG = {
  "15-July": {
    isoDate: "2026-07-15",
    time: "Time to be confirmed", // e.g. "10:00 AM – 12:00 PM BST"
    link: "", // Teams / Zoom URL for virtual sessions
  },
  "21-July": {
    isoDate: "2026-07-21",
    time: "Time to be confirmed",
    link: "",
  },
  "23-July": {
    isoDate: "2026-07-23",
    time: "Time to be confirmed",
    link: "",
  },
};

// ============================================================
// Entry point — receives POST from the registration form
// ============================================================

function doPost(e) {
  try {
    var raw = e.postData && e.postData.contents;
    if (!raw) {
      return jsonResponse({ success: false, message: "Invalid request." });
    }

    var data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      return jsonResponse({ success: false, message: "Invalid request body." });
    }

    // Honeypot — silently succeed to confuse bots
    if (typeof data.honeypot === "string" && data.honeypot.trim() !== "") {
      return jsonResponse({ success: true });
    }

    // Validate
    var validation = validatePayload(data);
    if (!validation.valid) {
      return jsonResponse({
        success: false,
        message: "Validation failed.",
        errors: validation.errors,
      });
    }

    // Sanitise
    var payload = sanitisePayload(data);

    // Duplicate check (same email + same session date)
    if (isDuplicate(payload.email, payload.preferredSessionDate)) {
      return jsonResponse({
        success: false,
        errorType: "duplicate",
        message:
          "It looks like you have already registered for this session with this email address. " +
          "If you believe this is an error, please contact the education team.",
      });
    }

    // Write to Google Sheet
    writeToSheet(payload);

    // Resolve session details for emails
    var config = SESSION_CONFIG[payload.preferredSessionDate] || {};
    var sessionDateFmt = formatDate(config.isoDate || "");
    var joiningLink = config.link || "";
    var sessionTime = config.time || "Time to be confirmed";

    // Confirmation email to registrant (non-fatal if it fails)
    try {
      sendConfirmationEmail(payload, sessionDateFmt, joiningLink, sessionTime);
    } catch (emailErr) {
      Logger.log("Confirmation email failed: " + emailErr);
    }

    // Organiser notification (best-effort)
    try {
      sendOrganiserNotification(payload, sessionDateFmt);
    } catch (err) {
      Logger.log("Organiser notification failed: " + err);
    }

    return jsonResponse({
      success: true,
      message: "Registration successful.",
      sessionDate: sessionDateFmt,
    });
  } catch (err) {
    Logger.log("Unhandled error: " + err);
    return jsonResponse({
      success: false,
      message:
        "An error occurred while processing your registration. " +
        "Please try again or contact the education team if the problem persists.",
    });
  }
}

// ============================================================
// Validation
// ============================================================

function validatePayload(p) {
  if (typeof p !== "object" || p === null) {
    return { valid: false, errors: ["Invalid request body."] };
  }

  var errors = [];

  if (
    !p.fullName ||
    typeof p.fullName !== "string" ||
    p.fullName.trim().length < 2
  ) {
    errors.push("Full name is required (minimum 2 characters).");
  }

  if (!p.email || typeof p.email !== "string") {
    errors.push("Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email.trim())) {
    errors.push("A valid email address is required.");
  }

  if (
    !p.trustOrganisation ||
    typeof p.trustOrganisation !== "string" ||
    !p.trustOrganisation.trim()
  ) {
    errors.push("Trust or organisation is required.");
  }

  if (
    !p.professionRole ||
    typeof p.professionRole !== "string" ||
    !p.professionRole.trim()
  ) {
    errors.push("Profession or role is required.");
  }

  if (
    !p.placeOfWork ||
    typeof p.placeOfWork !== "string" ||
    !p.placeOfWork.trim()
  ) {
    errors.push("Place of work is required.");
  }

  var validDates = ["15-July", "21-July", "23-July"];
  if (
    !p.preferredSessionDate ||
    validDates.indexOf(p.preferredSessionDate) === -1
  ) {
    errors.push("A valid preferred session date must be selected.");
  }

  if (
    p.sessionFormat !== undefined &&
    p.sessionFormat !== "" &&
    ["in-person", "virtual"].indexOf(p.sessionFormat) === -1
  ) {
    errors.push("Invalid session format value.");
  }

  if (typeof p.willingToBeContacted !== "boolean") {
    errors.push(
      "Please indicate whether you are willing to be contacted for further education.",
    );
  }

  if (p.contactPhoneNumber && typeof p.contactPhoneNumber === "string") {
    var phone = p.contactPhoneNumber.trim();
    if (phone.length > 0 && !/^[\d\s+\-()\[\]]{7,20}$/.test(phone)) {
      errors.push("Invalid phone number format.");
    }
  }

  if (p.gdprConsent !== true) {
    errors.push("GDPR consent is required.");
  }

  // Field length limits
  var limits = {
    fullName: 200,
    email: 254,
    trustOrganisation: 200,
    professionRole: 100,
    departmentSpecialty: 200,
    placeOfWork: 200,
    contactPhoneNumber: 50,
    accessibilityRequirements: 500,
    howDidYouHear: 200,
  };

  for (var field in limits) {
    if (typeof p[field] === "string" && p[field].length > limits[field]) {
      errors.push('Field "' + field + '" exceeds the maximum allowed length.');
    }
  }

  return { valid: errors.length === 0, errors: errors };
}

// ============================================================
// Sanitisation
// ============================================================

function sanitise(input, maxLength) {
  if (!input) return "";
  return String(input)
    .replace(/[<>]/g, "")
    .trim()
    .substring(0, maxLength || 500);
}

function sanitisePayload(p) {
  return {
    fullName: sanitise(p.fullName, 200),
    email: p.email.trim().toLowerCase().substring(0, 254),
    trustOrganisation: sanitise(p.trustOrganisation, 200),
    professionRole: sanitise(p.professionRole, 100),
    departmentSpecialty: sanitise(p.departmentSpecialty, 200) || "",
    placeOfWork: sanitise(p.placeOfWork, 200),
    preferredSessionDate: p.preferredSessionDate,
    sessionFormat: p.sessionFormat || "",
    willingToBeContacted: p.willingToBeContacted === true,
    contactPhoneNumber: sanitise(p.contactPhoneNumber, 50) || "",
    accessibilityRequirements: sanitise(p.accessibilityRequirements, 500) || "",
    howDidYouHear: sanitise(p.howDidYouHear, 200) || "",
    gdprConsent: true,
  };
}

// ============================================================
// Google Sheets helpers
// ============================================================

function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      "Submitted At",
      "Full Name",
      "Email",
      "Trust / Organisation",
      "Profession / Role",
      "Department / Specialty",
      "Place of Work",
      "Session Date",
      "Session Format",
      "Willing to be Contacted",
      "Phone Number",
      "Accessibility / Dietary Requirements",
      "How Did They Hear",
      "GDPR Consent",
    ]);
  }
  return sheet;
}

function isDuplicate(email, sessionDate) {
  var sheet = getSheet();
  var data = sheet.getDataRange().getValues();
  // Row 0 is headers; email is column index 2, session date is column index 7
  for (var i = 1; i < data.length; i++) {
    if (
      String(data[i][2]).toLowerCase() === email.toLowerCase() &&
      String(data[i][7]) === sessionDate
    ) {
      return true;
    }
  }
  return false;
}

function writeToSheet(payload) {
  var sheet = getSheet();
  sheet.appendRow([
    new Date().toISOString(),
    payload.fullName,
    payload.email,
    payload.trustOrganisation,
    payload.professionRole,
    payload.departmentSpecialty,
    payload.placeOfWork,
    payload.preferredSessionDate,
    payload.sessionFormat,
    payload.willingToBeContacted ? "Yes" : "No",
    payload.contactPhoneNumber,
    payload.accessibilityRequirements,
    payload.howDidYouHear,
    payload.gdprConsent ? "Yes" : "No",
  ]);
}

// ============================================================
// Date formatting
// ============================================================

function formatDate(isoDate) {
  if (!isoDate) return "your selected session";
  try {
    var d = new Date(isoDate);
    return Utilities.formatDate(d, "Europe/London", "EEEE d MMMM yyyy");
  } catch (_) {
    return isoDate;
  }
}

// ============================================================
// Email helpers
// ============================================================

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendConfirmationEmail(
  payload,
  sessionDateFmt,
  joiningLink,
  sessionTime,
) {
  var isVirtual = payload.sessionFormat !== "in-person";

  var joiningLinkSection = "";
  if (isVirtual && joiningLink) {
    var safeLink = escapeHtml(joiningLink);
    joiningLinkSection =
      '<div style="margin-top:20px;">' +
      '<p style="margin:0 0 10px;font-weight:700;font-size:15px;color:#212b32;">Virtual Joining Link</p>' +
      '<a href="' +
      safeLink +
      '" style="display:inline-block;background-color:#007f3b;color:#ffffff;' +
      'text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:700;font-size:15px;">' +
      "Join Session" +
      "</a>" +
      '<p style="margin:10px 0 0;font-size:13px;color:#425563;word-break:break-all;">' +
      'Or copy this link: <a href="' +
      safeLink +
      '" style="color:#005eb8;">' +
      safeLink +
      "</a>" +
      "</p>" +
      "</div>";
  }

  var locationRow = "";
  if (!isVirtual) {
    locationRow =
      "<tr>" +
      '<td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Location:</td>' +
      '<td style="padding:5px 0;font-size:14px;">' +
      escapeHtml(SESSION_LOCATION) +
      "</td>" +
      "</tr>";
  }

  var formatLabel =
    payload.sessionFormat === "in-person" ? "In-person" : "Virtual";

  var emailHtml =
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    "<title>Registration Confirmed</title></head>" +
    "<body style=\"margin:0;padding:0;font-family:Arial,'Helvetica Neue',sans-serif;background-color:#f0f4f5;color:#212b32;\">" +
    '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f0f4f5;">' +
    '<tr><td align="center" style="padding:24px 16px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" ' +
    'style="max-width:600px;background-color:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #d8dde0;">' +
    '<tr><td style="background-color:#005eb8;padding:24px 32px;">' +
    '<h1 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">Manuka Honey Gentell</h1>' +
    '<p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">Education Session \u2014 Registration Confirmed</p>' +
    "</td></tr>" +
    '<tr><td style="padding:32px;">' +
    '<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Dear ' +
    escapeHtml(payload.fullName) +
    ",</p>" +
    '<p style="margin:0 0 24px;font-size:16px;line-height:1.6;">Thank you for registering for the ' +
    "<strong>Manuka Honey Gentell Education Session</strong>. Your place has been reserved.</p>" +
    '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" ' +
    'style="background-color:#f0f4f5;border-left:4px solid #005eb8;border-radius:0 4px 4px 0;margin-bottom:24px;">' +
    '<tr><td style="padding:20px 24px;">' +
    '<h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#005eb8;">Your Session Details</h2>' +
    '<table cellpadding="0" cellspacing="0" role="presentation">' +
    "<tr>" +
    '<td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Date:</td>' +
    '<td style="padding:5px 0;font-size:14px;">' +
    escapeHtml(sessionDateFmt) +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Time:</td>' +
    '<td style="padding:5px 0;font-size:14px;">' +
    escapeHtml(sessionTime) +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td style="padding:5px 16px 5px 0;font-weight:700;white-space:nowrap;color:#425563;font-size:14px;">Format:</td>' +
    '<td style="padding:5px 0;font-size:14px;">' +
    escapeHtml(formatLabel) +
    "</td>" +
    "</tr>" +
    locationRow +
    "</table>" +
    joiningLinkSection +
    "</td></tr></table>" +
    '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#425563;">' +
    "Please add this session to your calendar. If you are unable to attend, " +
    "please let us know as soon as possible so your place can be offered to someone on the waiting list." +
    "</p>" +
    '<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#425563;">' +
    "If you have any questions, please reply to this email and a member of the education team will be in touch." +
    "</p>" +
    '<p style="margin:0;font-size:16px;line-height:1.6;">' +
    "We look forward to seeing you there.<br><br>Kind regards,<br>" +
    "<strong>The Manuka Honey Gentell Education Team</strong>" +
    "</p>" +
    "</td></tr>" +
    '<tr><td style="background-color:#425563;padding:18px 32px;">' +
    '<p style="margin:0;font-size:12px;color:#d8dde0;line-height:1.5;">' +
    "This is an automated confirmation email. Your personal data is processed in accordance with UK GDPR. " +
    "If you have accessibility requirements we have not yet addressed, please contact us directly." +
    "</p>" +
    "</td></tr>" +
    "</table></td></tr></table></body></html>";

  GmailApp.sendEmail(
    payload.email,
    "Registration Confirmed \u2014 Manuka Honey Gentell: " + sessionDateFmt,
    "Thank you for registering for the Manuka Honey Gentell Education Session on " +
      sessionDateFmt +
      ". Please view this email in an HTML-capable client for full details.",
    {
      htmlBody: emailHtml,
      name: SENDER_DISPLAY_NAME,
    },
  );
}

function sendOrganiserNotification(payload, sessionDateFmt) {
  if (!ORGANISER_EMAIL) return;

  function row(label, value) {
    return (
      "<tr>" +
      '<td style="padding:8px 12px;border:1px solid #d8dde0;background-color:#f0f4f5;' +
      'font-weight:700;font-size:13px;width:40%;vertical-align:top;">' +
      escapeHtml(label) +
      "</td>" +
      '<td style="padding:8px 12px;border:1px solid #d8dde0;font-size:13px;vertical-align:top;">' +
      escapeHtml(value) +
      "</td>" +
      "</tr>"
    );
  }

  var tableRows = [
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
    row("Submitted At", new Date().toLocaleString("en-GB")),
  ].join("");

  var emailHtml =
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>New Registration</title></head>' +
    '<body style="font-family:Arial,sans-serif;color:#212b32;padding:20px;">' +
    '<h2 style="color:#005eb8;">New Registration \u2014 Manuka Honey Gentell</h2>' +
    '<p style="color:#425563;margin-bottom:16px;">A new registration has been submitted. Details are shown below.</p>' +
    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:600px;">' +
    tableRows +
    "</table></body></html>";

  GmailApp.sendEmail(
    ORGANISER_EMAIL,
    "New Registration: " + payload.fullName + " \u2014 " + sessionDateFmt,
    payload.fullName +
      " has registered for the session on " +
      sessionDateFmt +
      ".",
    {
      htmlBody: emailHtml,
      name: SENDER_DISPLAY_NAME,
    },
  );
}

// ============================================================
// Utility
// ============================================================

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
