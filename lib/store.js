// Very simple JSON-file "database" so this app doesn't need a real database to launch.
//
// HONEST LIMITATION: on free hosting tiers (Render, Railway free plans) the filesystem
// can be wiped on redeploy or when the service sleeps and wakes up. That means free-tier
// usage counts and purchased credits could occasionally reset. This is fine to launch with -
// it will not lose anyone's money since Stripe is the source of truth for payments - but once
// this app is making consistent sales, swap this file for a real database (Supabase's free
// Postgres tier is a good next step, ask Claude to help you migrate when you're ready).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data.json');

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { usage: {}, licenses: {}, sessions: {} };
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getFreeUsesLeft(ip, freeLimit) {
  const db = readDB();
  const rec = db.usage[ip];
  const today = todayKey();
  if (!rec || rec.date !== today) return freeLimit;
  return Math.max(0, freeLimit - rec.count);
}

function recordFreeUse(ip) {
  const db = readDB();
  const today = todayKey();
  const rec = db.usage[ip];
  if (!rec || rec.date !== today) {
    db.usage[ip] = { date: today, count: 1 };
  } else {
    rec.count += 1;
  }
  writeDB(db);
}

// Idempotent: calling this twice for the same Stripe session_id (e.g. user refreshes
// the success page) returns the SAME license key instead of granting credits twice.
function createLicenseForSession(sessionId, credits) {
  const db = readDB();
  db.licenses = db.licenses || {};
  db.sessions = db.sessions || {};
  if (db.sessions[sessionId]) {
    return db.sessions[sessionId];
  }
  const licenseKey =
    'K-' + crypto.randomBytes(3).toString('hex').toUpperCase() +
    '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  db.licenses[licenseKey] = { credits, createdAt: Date.now() };
  db.sessions[sessionId] = licenseKey;
  writeDB(db);
  return licenseKey;
}

function getCredits(licenseKey) {
  const db = readDB();
  const rec = db.licenses[licenseKey];
  return rec ? rec.credits : 0;
}

function useCredit(licenseKey) {
  const db = readDB();
  const rec = db.licenses[licenseKey];
  if (!rec || rec.credits <= 0) return false;
  rec.credits -= 1;
  writeDB(db);
  return true;
}

module.exports = {
  getFreeUsesLeft,
  recordFreeUse,
  createLicenseForSession,
  getCredits,
  useCredit
};
