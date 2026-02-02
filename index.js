import express from "express";

const app = express();
app.use(express.json({ type: "*/*" }));

app.get("/", (req, res) => res.status(200).send("LavaLava Payments OK"));

app.post("/webhook/mercadopago", (req, res) => {
  // For now: just acknowledge receipt.
  // We’ll add signature verification + payment status update next.
  console.log("MP WEBHOOK:", JSON.stringify(req.body));
  res.status(200).send("ok");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
