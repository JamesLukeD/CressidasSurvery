"use strict";

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const { initDb, isDuplicate, insertRegistration } = require("./db");
const { sendConfirmationEmail, sendOrganiserNotification } = require("./email");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Trust reverse proxy (Nginx / Railway) for correct client IP ─
app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────
app.use(helmet());

// ── JSON body (10 KB limit) ───────────────────────────────────
app.use(express.json({ limit: "10kb" }));

// ── Rate limiter: 5 submissions per IP per 15 minutes ─────────
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many requests. Please wait a few minutes before trying again.",
  },
});

// ── Serve static files from the project root ──────────────────
app.use(express.static(path.join(__dirname, "..")));

// ── Session configuration ─────────────────────────────────────
const SESSION_CONFIG = {
  "15-July": {
    iso: "2026-07-15",
    timeEnv: "SESSION_TIME_15_JULY",
    linkEnv: "JOINING_LINK_15_JULY",
  },
  "21-July": {
    iso: "2026-07-21",
    timeEnv: "SESSION_TIME_21_JULY",
    linkEnv: "JOINING_LINK_21_JULY",
  },
  "23-July": {
    iso: "2026-07-23",
    timeEnv: "SESSION_TIME_23_JULY",
    linkEnv: "JOINING_LINK_23_JULY",
  },
};

function formatSessionDate(sessionDate) {
  const config = SESSION_CONFIG[sessionDate];
  if (!config) return sessionDate;
  try {
    return new Date(config.iso).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/London",
    });
  } catch {
    return config.iso;
  }
}

// ── Input validation ──────────────────────────────────────────
function sanitise(input, maxLength = 500) {
  if (!input) return "";
  return String(input).replace(/[<>]/g, "").trim().substring(0, maxLength);
}

function validatePayload(p) {
  if (typeof p !== "object" || p === null) {
    return { valid: false, errors: ["Invalid request body."] };
  }

  const errors = [];

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

  const validDates = ["15-July", "21-July", "23-July"];
  if (!p.preferredSessionDate || !validDates.includes(p.preferredSessionDate)) {
    errors.push("A valid preferred session date must be selected.");
  }

  if (
    p.sessionFormat !== undefined &&
    p.sessionFormat !== "" &&
    !["in-person", "virtual"].includes(p.sessionFormat)
  ) {
    errors.push("Invalid session format value.");
  }

  if (typeof p.willingToBeContacted !== "boolean") {
    errors.push(
      "Please indicate whether you are willing to be contacted for further education.",
    );
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

  const lengthLimits = {
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

  for (const [field, limit] of Object.entries(lengthLimits)) {
    if (typeof p[field] === "string" && p[field].length > limit) {
      errors.push(`Field "${field}" exceeds the maximum allowed length.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── POST /register ────────────────────────────────────────────
app.post("/register", registrationLimiter, async (req, res) => {
  const body = req.body;

  // Honeypot — silently succeed to confuse bots
  if (typeof body.honeypot === "string" && body.honeypot.trim() !== "") {
    return res.json({ success: true });
  }

  // Validate
  const { valid, errors } = validatePayload(body);
  if (!valid) {
    return res
      .status(400)
      .json({ success: false, message: "Validation failed.", errors });
  }

  // Sanitise
  const payload = {
    fullName: sanitise(body.fullName, 200),
    email: body.email.trim().toLowerCase().substring(0, 254),
    trustOrganisation: sanitise(body.trustOrganisation, 200),
    professionRole: sanitise(body.professionRole, 100),
    departmentSpecialty: sanitise(body.departmentSpecialty, 200) || null,
    placeOfWork: sanitise(body.placeOfWork, 200),
    preferredSessionDate: body.preferredSessionDate,
    sessionFormat: body.sessionFormat || null,
    willingToBeContacted: body.willingToBeContacted === true,
    contactPhoneNumber: sanitise(body.contactPhoneNumber, 50) || null,
    accessibilityRequirements:
      sanitise(body.accessibilityRequirements, 500) || null,
    howDidYouHear: sanitise(body.howDidYouHear, 200) || null,
    gdprConsent: true,
  };

  try {
    // Duplicate check
    if (await isDuplicate(payload.email, payload.preferredSessionDate)) {
      return res.status(409).json({
        success: false,
        errorType: "duplicate",
        message:
          "It looks like you have already registered for this session with this email address. " +
          "If you believe this is an error, please contact the education team.",
      });
    }

    // Write to database
    insertRegistration(payload);

    // Session details
    const config = SESSION_CONFIG[payload.preferredSessionDate] || {};
    const sessionDateFmt = formatSessionDate(payload.preferredSessionDate);
    const joiningLink = process.env[config.linkEnv] || "";
    const sessionTime = process.env[config.timeEnv] || "Time to be confirmed";

    // Confirmation email (non-fatal)
    try {
      await sendConfirmationEmail(
        payload,
        sessionDateFmt,
        joiningLink,
        sessionTime,
      );
    } catch (emailErr) {
      console.error(
        "Confirmation email failed — registration was still saved:",
        emailErr.message,
      );
    }

    // Organiser notification (fire-and-forget)
    sendOrganiserNotification(payload, sessionDateFmt).catch((err) =>
      console.error("Organiser notification failed:", err.message),
    );

    return res.json({
      success: true,
      message: "Registration successful.",
      sessionDate: sessionDateFmt,
    });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({
      success: false,
      message:
        "An error occurred while processing your registration. " +
        "Please try again or contact the education team if the problem persists.",
    });
  }
});

// ── Start ─────────────────────────────────────────────────────
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialise database:", err);
    process.exit(1);
  });
