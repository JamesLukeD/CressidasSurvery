"use strict";

const { Pool } = require("pg");

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("[db] DATABASE_URL is not set — cannot connect to PostgreSQL.");
  process.exit(1);
}

console.log("[db] DATABASE_URL present, connecting...");

const pool = new Pool({
  connectionString: dbUrl,
  // Enable SSL for any remote host (Railway, Render, Supabase, etc.)
  ssl:
    dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id                         SERIAL      PRIMARY KEY,
      submitted_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      full_name                  TEXT        NOT NULL,
      email                      TEXT        NOT NULL,
      trust_organisation         TEXT        NOT NULL,
      profession_role            TEXT        NOT NULL,
      department_specialty       TEXT,
      place_of_work              TEXT        NOT NULL,
      preferred_session_date     TEXT        NOT NULL,
      session_format             TEXT,
      willing_to_be_contacted    BOOLEAN     NOT NULL,
      contact_phone_number       TEXT,
      accessibility_requirements TEXT,
      how_did_you_hear           TEXT,
      gdpr_consent               BOOLEAN     NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_email_date
    ON registrations (lower(email), preferred_session_date)
  `);
}

async function isDuplicate(email, sessionDate) {
  const result = await pool.query(
    `SELECT id FROM registrations
     WHERE lower(email) = lower($1) AND preferred_session_date = $2
     LIMIT 1`,
    [email, sessionDate],
  );
  return result.rows.length > 0;
}

async function insertRegistration(payload) {
  await pool.query(
    `INSERT INTO registrations (
       full_name, email, trust_organisation, profession_role,
       department_specialty, place_of_work, preferred_session_date, session_format,
       willing_to_be_contacted, contact_phone_number, accessibility_requirements,
       gdpr_consent
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      payload.fullName,
      payload.email,
      payload.trustOrganisation,
      payload.professionRole,
      payload.departmentSpecialty ?? null,
      payload.placeOfWork,
      payload.preferredSessionDate,
      payload.sessionFormat ?? null,
      payload.willingToBeContacted,
      payload.contactPhoneNumber ?? null,
      payload.accessibilityRequirements ?? null,
      true,
    ],
  );
}

module.exports = { initDb, isDuplicate, insertRegistration };
