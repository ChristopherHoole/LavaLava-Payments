import express from "express";
import crypto from "crypto";

const app = express();

/**
 * Mercado Pago sometimes sends different content-types.
 * This accepts JSON for most cases.
 */
app.use(express.json({ type: ["application/json", "application/*+json", "*/*"] }));

/** ----------------------------
 * Config (Render Env Vars)
 * ---------------------------- */
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";
const MP_PAYER_EMAIL = process.env.MP_PAYER_EMAIL || "";
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";

/**
 * Optional: set this if you want MP to call a different webhook URL per env
 * If not set, we default to your current Render URL webhook path.
 */
const DEFAULT_WEBHOOK_URL = "https://lavalava-payments.onrender.com/webhook/mercadopago";
const MP_WEBHOOK_URL = process.env.MP_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

function maskToken(token) {
  if (!token) return "";
  if (token.length <= 10) return token;
  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

function requireToken(res) {
  if (!MP_ACCESS_TOKEN) {
    res.status(500).json({ ok: false, error: "MP_ACCESS_TOKEN is missing in environment variables." });
    return false;
  }
  return true;
}

/** ----------------------------
 * Simple request logger
 * ---------------------------- */
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`REQ: ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

/** ----------------------------
 * Health check
 * ---------------------------- */
app.get("/", (req, res) => {
  res.status(200).send("LavaLava Payments OK");
});

/** ----------------------------
 * Debug env (safe-ish)
 * ---------------------------- */
app.get("/debug/env", (req, res) => {
  res.json({
    ok: true,
    has_token: !!MP_ACCESS_TOKEN,
    token_len: MP_ACCESS_TOKEN ? MP_ACCESS_TOKEN.length : 0,
    token_masked: maskToken(MP_ACCESS_TOKEN),
    token_starts_with: MP_ACCESS_TOKEN ? MP_ACCESS_TOKEN.slice(0, 12) : "",
    payer_email: MP_PAYER_EMAIL || ""
  });
});

/** ----------------------------
 * Create PIX payment via Checkout API (/v1/payments)
 * Returns qr_code + qr_code_base64
 * ---------------------------- */
async function createPixPayment({ amount, description, external_reference, payer_email }) {
  const url = "https://api.mercadopago.com/v1/payments";

  // Mercado Pago recommends idempotency key for retries
  const idempotencyKey = crypto.randomUUID();

  const body = {
    transaction_amount: Number(amount),
    description: description || "LavaLava PIX",
    payment_method_id: "pix",
    payer: {
      email: payer_email || MP_PAYER_EMAIL || "test_user_123456@testuser.com"
    },
    external_reference: external_reference || undefined,
    notification_url: MP_WEBHOOK_URL
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body)
  });

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!resp.ok) {
    const err = new Error(`MP PIX CREATE FAILED: ${resp.status}`);
    err.status = resp.status;
    err.mp = json;
    throw err;
  }

  // Extract QR data
  const tx = json?.point_of_interaction?.transaction_data || {};
  return {
    payment_id: json.id,
    status: json.status,
    status_detail: json.status_detail,
    qr_code: tx.qr_code || null,
    qr_code_base64: tx.qr_code_base64 || null,
    ticket_url: tx.ticket_url || null,
    raw: json
  };
}

/** POST /pix/create */
app.post("/pix/create", async (req, res) => {
  try {
    if (!requireToken(res)) return;

    const { amount, description, external_reference, payer_email } = req.body || {};

    if (amount === undefined || amount === null || Number.isNaN(Number(amount))) {
      return res.status(400).json({ ok: false, error: "amount is required and must be a number" });
    }

    const result = await createPixPayment({
      amount,
      description,
      external_reference,
      payer_email
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error("MP PIX CREATE ERROR:", e?.status || "", e?.mp || e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "pix_create_failed",
      details: e?.mp || e?.message || String(e)
    });
  }
});

/**
 * Alias so your existing test that calls /qr/create still works.
 * POST /qr/create -> same as /pix/create
 */
app.post("/qr/create", async (req, res) => {
  // Just forward to the same handler logic:
  req.url = "/pix/create";
  app._router.handle(req, res, () => {});
});

/** GET /pix/status/:id */
app.get("/pix/status/:id", async (req, res) => {
  try {
    if (!requireToken(res)) return;

    const paymentId = req.params.id;
    if (!paymentId) return res.status(400).json({ ok: false, error: "payment id required" });

    const url = `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`
      }
    });

    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: "mp_status_failed", details: json });
    }

    return res.status(200).json({
      ok: true,
      id: json.id,
      status: json.status,
      status_detail: json.status_detail,
      external_reference: json.external_reference || null,
      transaction_amount: json.transaction_amount,
      payment_method_id: json.payment_method_id,
      payer: json.payer || null,
      raw: json
    });
  } catch (e) {
    console.error("MP STATUS ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "status_check_failed", details: e?.message || String(e) });
  }
});

/**
 * Webhook receiver
 * Mercado Pago will POST here for updates
 * For now: log + 200 OK
 *
 * (Later we can add signature verification if you want it strict)
 */
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    console.log("MP WEBHOOK RECEIVED");
    console.log("Headers:", JSON.stringify(req.headers));
    console.log("Body:", JSON.stringify(req.body));

    // Always acknowledge quickly
    return res.status(200).send("OK");
  } catch (e) {
    console.error("WEBHOOK ERROR:", e?.message || e);
    return res.status(200).send("OK");
  }
});

/** Fallback */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found", path: req.originalUrl });
});

/** Listen */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on ${port}`);
  console.log(`Webhook URL: ${MP_WEBHOOK_URL}`);
});
