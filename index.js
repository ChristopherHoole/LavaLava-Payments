import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

// Log every request (debug)
app.use((req, res, next) => {
  console.log("REQ:", req.method, req.originalUrl);
  next();
});

// Health check
app.get("/", (req, res) => {
  res.status(200).send("LavaLava Payments OK");
});

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// -------------------------
// PIX: Create payment
// -------------------------
app.post("/pix/create", async (req, res) => {
  try {
    const accessToken = mustGetEnv("MP_ACCESS_TOKEN");
    const payerEmail = process.env.MP_PAYER_EMAIL || "test@example.com";

    const amount = Number(req.body?.amount ?? 1.0);
    const description = String(req.body?.description ?? "LavaLava PIX Test R$1");
    const external_reference = String(req.body?.external_reference ?? "lavalava_test");

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const body = {
      transaction_amount: amount,
      description,
      payment_method_id: "pix",
      payer: { email: payerEmail },
      external_reference
    };

    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `lavalava_${external_reference}_${Date.now()}`
      },
      body: JSON.stringify(body)
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      console.log("MP CREATE ERROR:", mpRes.status, JSON.stringify(data));
      return res.status(502).json({ ok: false, mp_status: mpRes.status, mp_error: data });
    }

    const tx = data.point_of_interaction?.transaction_data || {};
    const qr_text = tx.qr_code || null;
    const qr_base64 = tx.qr_code_base64 || null;

    return res.status(200).json({
      ok: true,
      payment_id: data.id,
      status: data.status,
      qr_text,
      qr_base64
    });
  } catch (err) {
    console.log("PIX CREATE FAIL:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
});

// -------------------------
// Payment status
// -------------------------
app.get("/payment/status", async (req, res) => {
  try {
    const accessToken = mustGetEnv("MP_ACCESS_TOKEN");
    const id = String(req.query?.id || "");

    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      console.log("MP STATUS ERROR:", mpRes.status, JSON.stringify(data));
      return res.status(502).json({ ok: false, mp_status: mpRes.status, mp_error: data });
    }

    return res.status(200).json({
      ok: true,
      payment_id: data.id,
      status: data.status,
      status_detail: data.status_detail
    });
  } catch (err) {
    console.log("PAYMENT STATUS FAIL:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
});

// -------------------------
// Mercado Pago Webhook (log only for now)
// -------------------------
app.all("/webhook/mercadopago", (req, res) => {
  console.log("MP WEBHOOK HIT ✅");
  console.log("Method:", req.method);
  console.log("Headers:", JSON.stringify(req.headers));
  console.log("Body:", JSON.stringify(req.body || {}));
  res.status(200).send("ok");
});

// 404 fallback
app.use((req, res) => {
  console.log("404 FALLBACK ❌", req.method, req.originalUrl);
  res.status(404).send("not found");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
