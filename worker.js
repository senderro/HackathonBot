import Redis from "ioredis";
import express from "express";

const app = express();
app.get("/healthz", (_, res) => res.send("OK"));

const redis = new Redis(process.env.REDIS_URL);
const TOKEN = process.env.BOT_TOKEN;
const API   = `https://api.telegram.org/bot${TOKEN}`;

// Loop de consumo
async function consume() {
  while (true) {
    try {
      // bloqueia até ter um item; retorna [queue, data]
      const [, data] = await redis.brpop("telegram_queue", 0);
      const update = JSON.parse(data);
      const msg    = update.message;
      if (!msg?.text) continue;

      const chat_id = msg.chat.id;
      const text    = msg.text.trim().toLowerCase();
      const reply   = text === "ping" ? "pong" : "Envie 'ping' para testar!";

      await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text: reply })
      });
    } catch (err) {
      console.error("Worker error:", err);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Worker health check em http://0.0.0.0:${PORT}/healthz`);
  consume();
});
