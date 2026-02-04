import express from "express";

const app = express();
app.use(express.json());

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";
const MP_PAYER_EMAIL = process.env.MP_PAYER_EMAIL || "";

function maskToken(t) {
  if (!t) return "MISSING";
  return t.length > 8 ? `${t.slice(0,4)}...${t.slice(-4)}` : "SET";
}

app.get("/", (req, res) => res.send("OK"));

app.get("/debug/env", (req, res) => {
  res.json({
    MP_ACCESS_TOKEN: maskToken(MP_ACCESS_TOKEN),
    MP_PAYER_EMAIL: MP_PAYER_EMAIL || "MISSING"
  });
});

app.post("/pix/create", async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) return res.status(500).json({ error: "MP_ACCESS_TOKEN missing" });
    if (!MP_PAYER_EMAIL) return res.status(500).json({ error: "MP_PAYER_EMAIL missing" });

    const { amount, description, external_reference } = req.body || {};
    const transaction_amount = Number(amount);

    if (!Number.isFinite(transaction_amount) || transaction_amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const r = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transaction_amount,
        description,
        payment_method_id: "pix",
        payer: { email: MP_PAYER_EMAIL },
        external_reference
      })
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json(data);
    }

    const tx = data?.point_of_interaction?.transaction_data || {};

    res.json({
      id: data.id,
      status: data.status,
      qr_code: tx.qr_code,
      qr_code_base64: tx.qr_code_base64,
      ticket_url: tx.ticket_url
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/pix/status/:id", async (req, res) => {
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${req.params.id}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
  });
  const data = await r.json();
  res.status(r.status).json(data);
});

app.listen(process.env.PORT || 3000);

