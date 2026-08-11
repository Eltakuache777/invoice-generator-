# FreelanceKit

Free invoice builder (client-side, no AI cost) + AI-powered contract/SOW generator (free 1/day, then paid credits).

## 1. Get your API keys

Same two keys as ResumeFit:
1. **Anthropic API key** — https://console.anthropic.com → Settings → API Keys.
2. **Stripe secret key** — https://dashboard.stripe.com → Developers → API Keys. Finish Stripe's identity/bank verification now so payouts aren't delayed later.

If you already deployed ResumeFit, you can reuse the same Anthropic and Stripe accounts — you don't need separate ones. Just create a second API key if you want to tell usage apart, or reuse the same one.

## 2. Run locally

```
cd invoice-generator
cp .env.example .env
# fill in ANTHROPIC_API_KEY and STRIPE_SECRET_KEY in .env
npm install
npm start
```

Open http://localhost:3001 (note: different port than ResumeFit so you can run both at once locally). Test the invoice builder immediately — it needs no API key at all. Then test the contract generator with your Stripe test key and test card `4242 4242 4242 4242`.

## 3. Deploy for free (same steps as ResumeFit)

1. Push to a new GitHub repo.
2. Render.com → New → Web Service → connect the repo.
3. Build command `npm install`, start command `npm start`, Free instance.
4. Add the same environment variables as `.env.example`, with `PUBLIC_URL` set to your Render URL.
5. Deploy, then swap in your real `sk_live_...` Stripe key and redeploy.

## Why the invoice builder is free and unlimited

It runs entirely in the browser — no AI call, no server cost — so there's no reason to limit it. It's also what gets people in the door and coming back; the AI contract generator next to it is the part that makes money. This mirrors a common, proven pattern: a genuinely useful free tool paired with a paid upgrade for the harder problem.

## Known limitations (same as ResumeFit)

- Credits are stored in a simple JSON file, not a real database — fine to launch with, but read the note in ResumeFit's README about upgrading it once you have consistent sales.
- The "Download PDF" button uses the browser's built-in print-to-PDF, so there's zero extra cost or dependency, but formatting will look exactly like a browser print rather than a fully custom PDF layout. That's a fine trade-off for v1.
