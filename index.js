import crypto from "node:crypto";
import express from "express";

const app = express();
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";
const MP_PAYER_EMAIL = process.env.MP_PAYER_EMAIL || "";

function maskToken(t) {
  if (!t) return "MISSING";
  return t.length > 8 ? `${t.slice(0, 4)}...${t.slice(-4)}` : "SET";
}

app.get("/", (req, res) => {
  res.send("OK");
});

app.get("/debug/env", (req, res) => {
  res.json({
    MP_ACCESS_TOKEN: maskToken(MP_ACCESS_TOKEN),
    MP_PAYER_EMAIL: MP_PAYER_EMAIL || "MISSING"
  });
});

app.post("/pix/create", async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: "MP_ACCESS_TOKEN missing" });
    }

    if (!MP_PAYER_EMAIL) {
      return res.status(500).json({ error: "MP_PAYER_EMAIL missing" });
    }

    const { amount, description, external_reference } = req.body || {};
    const transaction_amount = Number(amount);

    if (!Number.isFinite(transaction_amount) || transaction_amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (!description || typeof description !== "string") {
      return res.status(400).json({ error: "Missing description" });
    }

    const idempotencyKey = crypto.randomUUID();

    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        transaction_amount,
        description,
        payment_method_id: "pix",
        payer: {
          email: MP_PAYER_EMAIL
        },
        external_reference: external_reference || undefined
      })
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const tx = data?.point_of_interaction?.transaction_data || {};

    return res.json({
      id: data.id,
      status: data.status,
      status_detail: data.status_detail,
      qr_code: tx.qr_code || null,
      qr_code_base64: tx.qr_code_base64 || null,
      ticket_url: tx.ticket_url || null
    });

  } catch (err) {
    return res.status(500).json({
      error: err?.message || String(err)
    });
  }
});

app.get("/pix/status/:payment_id", async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: "MP_ACCESS_TOKEN missing" });
    }

    const paymentId = req.params.payment_id;

    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${MP_ACCESS_TOKEN}`
        }
      }
    );

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(500).json({
      error: err?.message || String(err)
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LavaLava Payments running on port ${PORT}`);
});
