import express from "express";

const app = express();
app.use(express.json());

const redis = new Redis(process.env.REDIS_URL);
const TOKEN = process.env.BOT_TOKEN;
const API   = `https://api.telegram.org/bot${TOKEN}`;

// Rota que o Telegram vai chamar
app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  redis.lpush("telegram_queue", JSON.stringify(req.body))
       .catch(console.error);
});

// Health check opcional no Receiver
app.get("/healthz", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Receiver ouvindo em http://0.0.0.0:${PORT}`)
);