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

// Idempotent, same pattern as createLicenseForSession: refreshing the success page
// after a subscription checkout returns the same license instead of creating a new one.
function createSubscriptionForSession(sessionId, stripeSubscriptionId) {
  const db = readDB();
  db.subscriptions = db.subscriptions || {};
  db.subSessions = db.subSessions || {};
  if (db.subSessions[sessionId]) {
    return db.subSessions[sessionId];
  }
  const licenseKey =
    'S-' + crypto.randomBytes(3).toString('hex').toUpperCase() +
    '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  db.subscriptions[licenseKey] = { stripeSubscriptionId, createdAt: Date.now() };
  db.subSessions[sessionId] = licenseKey;
  writeDB(db);
  return licenseKey;
}

function getStripeSubscriptionId(licenseKey) {
  const db = readDB();
  const rec = (db.subscriptions || {})[licenseKey];
  return rec ? rec.stripeSubscriptionId : null;
}

/* ---------- Accounts (email + magic link) ----------
   Lightweight identity layer on top of the existing license-key system: an account just
   remembers which license keys belong to an email, so logging in on a new browser can
   restore access instead of starting from zero. */

function createMagicLinkToken(email) {
  const db = readDB();
  db.magicLinks = db.magicLinks || {};
  const token = crypto.randomBytes(24).toString('hex');
  db.magicLinks[token] = { email, expiresAt: Date.now() + 15 * 60 * 1000 };
  writeDB(db);
  return token;
}

// Single-use: consuming a token deletes it so the same email can't be replayed.
function consumeMagicLinkToken(token) {
  const db = readDB();
  db.magicLinks = db.magicLinks || {};
  const rec = db.magicLinks[token];
  if (!rec) return null;
  delete db.magicLinks[token];
  writeDB(db);
  if (rec.expiresAt < Date.now()) return null;
  return rec.email;
}

// Idempotent per email: logging in again returns the same account token instead of a new one.
function getOrCreateAccountToken(email) {
  const db = readDB();
  db.accounts = db.accounts || {};
  db.accountTokens = db.accountTokens || {};
  db.accounts[email] = db.accounts[email] || {};
  if (db.accounts[email].token) return db.accounts[email].token;
  const token = 'A-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  db.accounts[email].token = token;
  db.accountTokens[token] = email;
  writeDB(db);
  return token;
}

function getEmailForAccountToken(token) {
  const db = readDB();
  return (db.accountTokens || {})[token] || null;
}

// One contract-credit license per account, topped up on repeat purchases instead of
// creating a new (and therefore un-findable) license key each time.
function getOrCreateAccountCreditLicense(email) {
  const db = readDB();
  db.accounts = db.accounts || {};
  db.licenses = db.licenses || {};
  db.accounts[email] = db.accounts[email] || {};
  if (db.accounts[email].creditLicense) return db.accounts[email].creditLicense;
  const licenseKey =
    'K-' + crypto.randomBytes(3).toString('hex').toUpperCase() +
    '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  db.licenses[licenseKey] = { credits: 0, createdAt: Date.now() };
  db.accounts[email].creditLicense = licenseKey;
  writeDB(db);
  return licenseKey;
}

function addCredits(licenseKey, amount) {
  const db = readDB();
  db.licenses = db.licenses || {};
  db.licenses[licenseKey] = db.licenses[licenseKey] || { credits: 0, createdAt: Date.now() };
  db.licenses[licenseKey].credits += amount;
  writeDB(db);
}

// Separate idempotency guard for account-linked credit top-ups (createLicenseForSession's
// db.sessions map is for the anonymous one-license-per-purchase flow, not this one).
function wasSessionCredited(sessionId) {
  const db = readDB();
  return !!((db.creditedSessions || {})[sessionId]);
}

function markSessionCredited(sessionId) {
  const db = readDB();
  db.creditedSessions = db.creditedSessions || {};
  db.creditedSessions[sessionId] = true;
  writeDB(db);
}

function setAccountSubLicense(email, licenseKey) {
  const db = readDB();
  db.accounts = db.accounts || {};
  db.accounts[email] = db.accounts[email] || {};
  db.accounts[email].subLicense = licenseKey;
  writeDB(db);
}

// Simple abuse guard: without this, anyone can spam /api/auth/request-link with
// arbitrary emails and burn through the Resend quota for free.
function canRequestMagicLink(email) {
  const db = readDB();
  const rec = (db.magicLinkRequests || {})[email];
  if (!rec) return true;
  return Date.now() - rec.lastSentAt > 30 * 1000;
}

function recordMagicLinkRequest(email) {
  const db = readDB();
  db.magicLinkRequests = db.magicLinkRequests || {};
  db.magicLinkRequests[email] = { lastSentAt: Date.now() };
  writeDB(db);
}

function getAccountLicenses(email) {
  const db = readDB();
  const acc = (db.accounts || {})[email] || {};
  return { creditLicense: acc.creditLicense || null, subLicense: acc.subLicense || null };
}

module.exports = {
  getFreeUsesLeft,
  recordFreeUse,
  createLicenseForSession,
  getCredits,
  useCredit,
  createSubscriptionForSession,
  getStripeSubscriptionId,
  createMagicLinkToken,
  consumeMagicLinkToken,
  getOrCreateAccountToken,
  getEmailForAccountToken,
  getOrCreateAccountCreditLicense,
  addCredits,
  wasSessionCredited,
  markSessionCredited,
  setAccountSubLicense,
  getAccountLicenses,
  canRequestMagicLink,
  recordMagicLinkRequest
};
