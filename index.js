import express from "express";
import Redis from "ioredis";

const app = express();
app.use(express.json());


const redisOpts = {
  host:     process.env.REDIS_HOST,
  port:     parseInt(process.env.REDIS_PORT, 10),
  decode_responses: True,
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
};

const redis = new Redis(redisOpts);

const TOKEN = process.env.BOT_TOKEN;
const API   = `https://api.telegram.org/bot${TOKEN}`;

// Receiver: recebe webhook e empilha no Redis
app.post("/webhook", (req, res) => {
  console.log(" [Receiver] update recebido:", JSON.stringify(req.body));
  res.sendStatus(200); // ACK rápido ao Telegram
  redis.lpush("telegram_queue", JSON.stringify(req.body))
       .catch(console.error);
});

// Health check para o Render
app.get("/healthz", (_, res) => res.send("OK"));

// Worker: loop de consumo da fila e processamento
async function consume() {
  while (true) {
    try {
      console.log("… [Worker] aguardando item na fila");
      const [, data] = await redis.brpop("telegram_queue", 0);
      console.log("→ [Worker] resgatou da fila:", data);
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
      console.log(`→ [Worker] respondeu chat ${chat_id} com “${reply}”`);
    } catch (err) {
      console.error("Erro no worker:", err);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// Inicia HTTP e, assim que ouvir na porta, dispara o consumidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ouvindo em http://0.0.0.0:${PORT}`);
  consume();
});
