import express from "express";

const app = express();
app.use(express.json());

const TOKEN = process.env.BOT_TOKEN;
const API   = `https://api.telegram.org/bot${TOKEN}`;

// Webhook: recebe o update e já responde no mesmo fluxo
app.post("/webhook", async (req, res) => {
  const update = req.body;
  console.log("→ Received update:", JSON.stringify(update));

  // ACK imediato ao Telegram
  res.sendStatus(200);

  const msg = update.message;
  if (!msg?.text) return;

  const chat_id = msg.chat.id;
  const text    = msg.text.trim().toLowerCase();
  const reply   = text === "ping" ? "pong" : "Envie 'ping' para testar!";

  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text: reply })
    });
    console.log(`→ Replied to ${chat_id}: ${reply}`);
  } catch (err) {
    console.error("Error sending message:", err);
  }
});

// Health check para Render
app.get("/healthz", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
