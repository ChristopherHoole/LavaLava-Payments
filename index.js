import express from "express";

const app = express();

// Parse JSON (and tolerate odd content-types)
app.use(express.json({ type: "*/*" }));

// Log every request so we can see what Mercado Pago is doing
app.use((req, res, next) => {
  console.log("REQ:", req.method, req.originalUrl);
  next();
});

// Health check
app.get("/", (req, res) => {
  res.status(200).send("LavaLava Payments OK");
});

// Webhook route (accepts ANY method)
app.all("/webhook/mercadopago", (req, res) => {
  console.log("MP WEBHOOK HIT ✅");
  console.log("Method:", req.method);
  console.log("Headers:", JSON.stringify(req.headers));
  console.log("Body:", JSON.stringify(req.body || {}));
  res.status(200).send("ok");
});

// Fallback 404 (so we can see if MP is calling a different path)
app.use((req, res) => {
  console.log("404 FALLBACK ❌", req.method, req.originalUrl);
  res.status(404).send("not found");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on ${port}`);
});
