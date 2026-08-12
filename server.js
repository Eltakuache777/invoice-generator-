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

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
}

app.get('/api/config', (req, res) => {
  res.json({ freeDaily: FREE_DAILY, packPrice: PACK_PRICE, packCredits: PACK_CREDITS, subPrice: SUB_PRICE });
});

app.post('/api/generate-contract', async (req, res) => {
  try {
    const { yourName, clientName, workDescription, paymentTerms, contractType, licenseKey } = req.body || {};
    if (!yourName || !clientName || !workDescription) {
      return res.status(400).json({ error: 'Please fill in your name, the client name, and a description of the work.' });
    }
    if (workDescription.length > 8000) {
      return res.status(400).json({ error: 'That description is too long. Please trim it down.' });
    }

    const ip = getClientIp(req);
    let usedCredit = false;
    if (licenseKey && store.getCredits(licenseKey) > 0) {
      store.useCredit(licenseKey);
      usedCredit = true;
    } else {
      const freeLeft = store.getFreeUsesLeft(ip, FREE_DAILY);
      if (freeLeft <= 0) {
        return res.status(402).json({
          error: 'PAYMENT_REQUIRED',
          message: "You've used today's free contract generation. Buy a credit pack to keep going."
        });
      }
      store.recordFreeUse(ip);
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
    if (session.payment_status === 'paid') {
      const licenseKey = store.createLicenseForSession(session_id, PACK_CREDITS);
      return res.json({ paid: true, licenseKey, credits: store.getCredits(licenseKey) });
    }
    res.json({ paid: false });
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
      return res.json({ active: true, licenseKey });
    }
    res.json({ active: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not verify subscription.' });
  }
});

app.get('/api/subscription-status', async (req, res) => {
  try {
    const { licenseKey } = req.query;
    const subId = licenseKey ? store.getStripeSubscriptionId(licenseKey) : null;
    if (!subId) return res.json({ active: false });
    const sub = await stripe.subscriptions.retrieve(subId);
    res.json({ active: ACTIVE_SUB_STATUSES.includes(sub.status) });
  } catch (err) {
    console.error(err);
    res.json({ active: false });
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FreelanceKit running on port ${PORT}`));
