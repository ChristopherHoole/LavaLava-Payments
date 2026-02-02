import express from "express";

const app = express();

// Accept JSON from Mercado Pago (and simulators)
app.use(express.json({ type: "*/*" }));

// Health check
app.get("/", (req, res) => {
  res.status(200).send("LavaLava Payments OK");
});

// Mercado Pago Webhook (handles GET / POST / HEAD)
app.all("/webhook/mercadopago", (req, res) => {
  console.log("MP WEBHOOK RECEIVED");
  console.log("Method:", req.method);
  console.log("Headers:", JSON.stringify(req.headers));
  console.log("Body:", JSON.stringify(req.body || {}));

  // For now we only acknowledge receipt.
  // Signature verification + payment lookup comes next.
  res.status(200).send("ok");
});

// Render-provided port
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on ${port}`);
});
