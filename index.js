import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

app.use((req, res, next) => {
  console.log("REQ:", req.method, req.originalUrl);
  next();
});

app.get("/", (req, res) => {
  res.status(200).send("LavaLava Payments OK");
});

app.get("/debug/env", (req, res) => {
  const t = process.env.MP_ACCESS_TOKEN || "";
  const masked = t.length <= 12 ? t : `${t.slice(0, 6)}...${t.slice(-6)}`;
  res.status(200).json({
    ok: true,
    has_token: !!t,
    token_len: t.length,
    token_masked: masked,
    token_starts_with: t.slice(0, 12),
    payer_email: process.env.MP_PAYER_EMAIL || null
  });
});

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Mercado Pago QR / Orders style create
 * This creates an "order" with QR that can be used for PIX flow in QR integrations.
 */
app.post("/qr/create", async (req, res) => {
  try {
    const accessToken = mustGetEnv("MP_ACCESS_TOKEN");

    // We’ll keep it simple: R$1.00 default
    const amount = Number(req.body?.amount ?? 1.0);
    const title = String(req.body?.title ?? "LavaLava Test R$1");
    const external_reference = String(req.body?.external_reference ?? "test_washer_1");

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // Merchant Order payload (simple)
    const body = {
      external_reference,
      items: [
        {
          title,
          quantity: 1,
          unit_price: amount,
          currency_id: "BRL"
        }
      ]
    };

    const mpRes = await fetch("https://api.mercadopago.com/merchant_orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `lavalava_order_${external_reference}_${Date.now()}`
      },
      body: JSON.stringify(body)
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      console.log("MP ORDER CREATE ERROR:", mpRes.status, JSON.stringify(data));
      return res.status(502).json({ ok: false, mp_status: mpRes.status, mp_error: data });
    }

    // NOTE: Some accounts expose QR info via additional steps.
    // For now we return the order id + full payload so we can see what MP provides.
    return res.status(200).json({
      ok: true,
      order_id: data.id,
      status: data.status,
      raw: data
    });
  } catch (err) {
    console.log("QR CREATE FAIL:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
});

app.all("/webhook/mercadopago", (req, res) => {
  console.log("MP WEBHOOK HIT ✅");
  console.log("Method:", req.method);
  console.log("Headers:", JSON.stringify(req.headers));
  console.log("Body:", JSON.stringify(req.body || {}));
  res.status(200).send("ok");
});

app.use((req, res) => {
  console.log("404 FALLBACK ❌", req.method, req.originalUrl);
  res.status(404).send("not found");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
