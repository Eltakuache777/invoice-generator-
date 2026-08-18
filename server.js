require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const Stripe = require('stripe');
const store = require('./lib/store');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'missing' });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_missing', { apiVersion: '2024-06-20' });

const FREE_DAILY = parseInt(process.env.FREE_DAILY_GENERATIONS || '1', 10);
const PACK_PRICE = parseInt(process.env.CREDIT_PACK_PRICE_USD || '12', 10);
const PACK_CREDITS = parseInt(process.env.CREDIT_PACK_CREDITS || '15', 10);
const SUB_PRICE = parseInt(process.env.SUB_PRICE_USD || '20', 10);
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, '');

const ACTIVE_SUB_STATUSES = ['active', 'trialing'];

// Comma-separated list of emails that get unlimited free access to everything -
// for you, the site owner, so you're not paying yourself for your own product.
const OWNER_EMAILS = (process.env.OWNER_EMAIL || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isOwnerEmail(email) {
  return !!email && OWNER_EMAILS.includes(email.toLowerCase());
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
}

async function sendMagicLinkEmail(email, link) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured.');
  const from = process.env.RESEND_FROM_EMAIL || 'FreelanceKit <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: email,
      subject: 'Log in to FreelanceKit',
      html: `<p>Click below to log in to FreelanceKit on this device:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes. If you didn't request this, you can ignore this email.</p>`
    })
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error('Resend API error: ' + detail);
  }
}

app.get('/api/config', (req, res) => {
  res.json({ freeDaily: FREE_DAILY, packPrice: PACK_PRICE, packCredits: PACK_CREDITS, subPrice: SUB_PRICE });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/auth/request-link', async (req, res) => {
  try {
    const email = (req.body && req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!store.canRequestMagicLink(email)) {
      return res.status(429).json({ error: 'Please wait a bit before requesting another login link.' });
    }
    const token = store.createMagicLinkToken(email);
    const link = `${PUBLIC_URL}/?login_token=${token}`;
    store.recordMagicLinkRequest(email);
    await sendMagicLinkEmail(email, link);
    res.json({ sent: true });
  } catch (err) {
    console.error(err);
    // Surfacing the real reason (not just a generic guess) since this exact step has
    // been the hardest thing to debug without shell access to check Render's logs.
    res.status(500).json({ error: 'Could not send login email: ' + err.message });
  }
});

app.post('/api/auth/verify', (req, res) => {
  try {
    const { token } = req.body || {};
    const email = token ? store.consumeMagicLinkToken(token) : null;
    if (!email) {
      return res.status(400).json({ error: 'This login link is invalid or has expired. Request a new one.' });
    }
    const accountToken = store.getOrCreateAccountToken(email);
    const { creditLicense, subLicense } = store.getAccountLicenses(email);
    res.json({ accountToken, email, creditLicense, subLicense, isOwner: isOwnerEmail(email) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not verify login link.' });
  }
});

// If local data doesn't show an active subscription for this email, double-check
// directly with Stripe before concluding they're not subscribed - protects real
// paying customers from getting locked out just because Render's disk got wiped.
// Returns the active Stripe subscription id, or null if there genuinely isn't one.
async function findActiveSubscriptionId(email) {
  const { subLicense } = store.getAccountLicenses(email);
  if (subLicense) {
    const subId = store.getStripeSubscriptionId(subLicense);
    if (subId) {
      const sub = await stripe.subscriptions.retrieve(subId);
      if (ACTIVE_SUB_STATUSES.includes(sub.status)) return subId;
    }
  }
  try {
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length) {
      const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 1 });
      if (subs.data.length) {
        store.linkRecoveredSubscription(email, subs.data[0].id);
        return subs.data[0].id;
      }
    }
  } catch (err) {
    console.error('Stripe subscription recovery check failed:', err);
  }
  return null;
}

// Credit packs are one-time payments, not an ongoing Stripe object like a subscription,
// so there's no "is this customer still subscribed" flag to fall back on. Instead every
// credit-pack checkout tags its underlying PaymentIntent with metadata.accountEmail
// (Checkout Sessions themselves aren't searchable via Stripe's API, but PaymentIntents
// are), and if local data doesn't show a purchase we know about, we search Stripe
// directly and credit anything that hasn't been applied yet. Safe to re-run -
// wasSessionCredited guards against crediting the same payment twice.
async function recoverCreditsFromStripe(email) {
  try {
    const escaped = email.replace(/'/g, "\\'");
    const intents = await stripe.paymentIntents.search({
      query: `metadata['accountEmail']:'${escaped}' and status:'succeeded'`,
      limit: 100
    });
    for (const intent of intents.data) {
      if (store.wasSessionCredited(intent.id)) continue;
      const licenseKey = store.getOrCreateAccountCreditLicense(email);
      store.addCredits(licenseKey, PACK_CREDITS);
      store.markSessionCredited(intent.id);
    }
  } catch (err) {
    console.error('Stripe credit recovery check failed:', err);
  }
}

// Single source of truth the client polls on load: who is this, are they the owner
// (unlimited everything), and do they have an active Invoice/Receipt subscription.
app.get('/api/account-status', async (req, res) => {
  try {
    const { accountToken } = req.query;
    const email = accountToken ? store.getEmailForAccountToken(accountToken) : null;
    if (!email) return res.status(400).json({ error: 'Not logged in.' });

    const owner = isOwnerEmail(email);
    if (owner) return res.json({ email, isOwner: true, subscribed: true, freeLeft: FREE_DAILY, credits: 0 });

    const subscribed = !!(await findActiveSubscriptionId(email));
    await recoverCreditsFromStripe(email);
    const { creditLicense } = store.getAccountLicenses(email);
    const credits = creditLicense ? store.getCredits(creditLicense) : 0;
    const freeLeft = store.getFreeUsesLeft(email, FREE_DAILY);
    res.json({ email, isOwner: false, subscribed, freeLeft, credits });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not check account status.' });
  }
});

app.post('/api/generate-contract', async (req, res) => {
  try {
    const { yourName, clientName, workDescription, paymentTerms, contractType, licenseKey, accountToken } = req.body || {};
    if (!yourName || !clientName || !workDescription) {
      return res.status(400).json({ error: 'Please fill in your name, the client name, and a description of the work.' });
    }
    if (workDescription.length > 8000) {
      return res.status(400).json({ error: 'That description is too long. Please trim it down.' });
    }

    const accountEmail = accountToken ? store.getEmailForAccountToken(accountToken) : null;
    const owner = isOwnerEmail(accountEmail);

    // Logged in: track free-daily-use and credits against the account (survives switching
    // devices/networks). Not logged in (shouldn't normally happen behind the login gate,
    // but kept as a safe fallback): track against IP like before.
    const freeUseKey = accountEmail || getClientIp(req);
    let effectiveLicenseKey = accountEmail ? (store.getAccountLicenses(accountEmail).creditLicense || licenseKey) : licenseKey;

    let usedCredit = false;
    if (owner) {
      // Site owner: unlimited, doesn't touch credits or the free-daily counter.
    } else if (effectiveLicenseKey && store.getCredits(effectiveLicenseKey) > 0) {
      store.useCredit(effectiveLicenseKey);
      usedCredit = true;
    } else {
      // Local data says no credits - before actually blocking them, check whether Stripe
      // has a paid credit-pack session for this account that local data lost track of.
      if (accountEmail) {
        await recoverCreditsFromStripe(accountEmail);
        effectiveLicenseKey = store.getAccountLicenses(accountEmail).creditLicense || effectiveLicenseKey;
      }
      if (effectiveLicenseKey && store.getCredits(effectiveLicenseKey) > 0) {
        store.useCredit(effectiveLicenseKey);
        usedCredit = true;
      } else {
        const freeLeft = store.getFreeUsesLeft(freeUseKey, FREE_DAILY);
        if (freeLeft <= 0) {
          return res.status(402).json({
            error: 'PAYMENT_REQUIRED',
            message: "You've used today's free contract generation. Buy a credit pack to keep going."
          });
        }
        store.recordFreeUse(freeUseKey);
      }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Server is not configured with an ANTHROPIC_API_KEY yet.' });
    }

    const kind = contractType === 'nda' ? 'a mutual non-disclosure agreement (NDA)'
      : contractType === 'retainer' ? 'a monthly retainer service agreement'
      : 'a freelance services agreement / statement of work';

    const systemPrompt = `You are a contracts assistant who drafts clear, plain-English small-business contracts for freelancers. You are NOT a lawyer and must never claim to be one. Draft ${kind} between the two named parties based on the work description and payment terms given.

Include standard, sensible sections such as: Parties, Scope of Work / Services, Payment Terms, Timeline/Deliverables (if applicable), Revisions Policy, Intellectual Property / Ownership (work product transfers to the client upon full payment), Confidentiality, Termination, Independent Contractor status, Limitation of Liability, and Signatures.

Write it in clear plain English, not dense legalese. Use the exact names given for the parties. If payment terms aren't fully specified, use reasonable freelance-industry defaults (e.g. 50% upfront, 50% on completion, net-15 for retainers) and note that these are defaults the user should edit.

At the very end, add a short section titled "IMPORTANT" reminding the user this is an AI-generated starting draft, not legal advice, and that they should have a lawyer review it before using it for large or high-risk engagements.

Output only the contract text, no preamble like "Here is your contract".`;

    const userPrompt = `Freelancer / Service Provider: ${yourName}\nClient: ${clientName}\nDescription of work: ${workDescription}\nPayment terms (if specified by user): ${paymentTerms || 'not specified, use reasonable defaults'}`;

    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const text = msg.content.map((b) => b.text || '').join('\n');
    res.json({ contract: text, usedCredit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong generating the contract. Please try again in a moment.' });
  }
});

app.post('/api/checkout', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe is not configured yet.' });
    }
    const { accountToken } = req.body || {};
    const accountEmail = accountToken ? store.getEmailForAccountToken(accountToken) : null;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `FreelanceKit - ${PACK_CREDITS} contract credits` },
            unit_amount: PACK_PRICE * 100
          },
          quantity: 1
        }
      ],
      metadata: accountEmail ? { accountEmail } : {},
      // Also tag the underlying PaymentIntent (not just the Checkout Session) - Checkout
      // Sessions aren't searchable via Stripe's API, but PaymentIntents are, and that's
      // what recoverCreditsFromStripe() below queries to rebuild a lost credit balance.
      payment_intent_data: accountEmail ? { metadata: { accountEmail } } : undefined,
      success_url: `${PUBLIC_URL}/?purchase=credits&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_URL}/`
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not start checkout. Double check your Stripe secret key.' });
  }
});

app.get('/api/verify-session', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'Missing session_id' });
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.json({ paid: false });
    }
    const accountEmail = session.metadata && session.metadata.accountEmail;
    let licenseKey;
    if (accountEmail) {
      // Logged-in purchase: top up the account's single credit license instead of
      // minting a new, un-findable one - so repeat purchases and other devices see it.
      licenseKey = store.getOrCreateAccountCreditLicense(accountEmail);
      if (!store.wasSessionCredited(session_id)) {
        store.addCredits(licenseKey, PACK_CREDITS);
        store.markSessionCredited(session_id);
      }
    } else {
      licenseKey = store.createLicenseForSession(session_id, PACK_CREDITS);
    }
    res.json({ paid: true, licenseKey, credits: store.getCredits(licenseKey) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not verify payment.' });
  }
});

// Invoice Builder + Receipt Generator are gated behind this $20/mo subscription.
// The Contract Generator is unaffected - it stays on the free-daily-limit + credit-pack model above.
app.post('/api/subscribe', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe is not configured yet.' });
    }
    const { accountToken } = req.body || {};
    const accountEmail = accountToken ? store.getEmailForAccountToken(accountToken) : null;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'FreelanceKit Pro - Invoice & Receipt tools' },
            recurring: { interval: 'month' },
            unit_amount: SUB_PRICE * 100
          },
          quantity: 1
        }
      ],
      metadata: accountEmail ? { accountEmail } : {},
      success_url: `${PUBLIC_URL}/?purchase=sub&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_URL}/`
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not start checkout. Double check your Stripe secret key.' });
  }
});

app.get('/api/verify-subscription', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'Missing session_id' });
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
    const sub = session.subscription;
    if (sub && ACTIVE_SUB_STATUSES.includes(sub.status)) {
      const licenseKey = store.createSubscriptionForSession(session_id, sub.id);
      const accountEmail = session.metadata && session.metadata.accountEmail;
      if (accountEmail) store.setAccountSubLicense(accountEmail, licenseKey);
      return res.json({ active: true, licenseKey });
    }
    res.json({ active: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not verify subscription.' });
  }
});

app.post('/api/portal-session', async (req, res) => {
  try {
    const { accountToken } = req.body || {};
    const accountEmail = accountToken ? store.getEmailForAccountToken(accountToken) : null;
    const subId = accountEmail ? await findActiveSubscriptionId(accountEmail) : null;
    if (!subId) return res.status(400).json({ error: 'No active subscription found for this account.' });
    const sub = await stripe.subscriptions.retrieve(subId);
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.customer,
      return_url: `${PUBLIC_URL}/`
    });
    res.json({ url: portal.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not open the subscription management page. If this is a live Stripe account, make sure the Customer Portal is activated at dashboard.stripe.com/settings/billing/portal.' });
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FreelanceKit running on port ${PORT}`));
