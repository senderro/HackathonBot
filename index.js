import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const TOKEN = "7746829181:AAEA4ZurgJtv-84aX9JP6hIoAh1FErA6n-A"; //pelo amor de deus alguem cria um .env no futuro e coloca isso
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

// Rota que o Telegram vai chamar
app.post("/webhook", async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) {
    return res.sendStatus(200);
  }

  const chat_id = msg.chat.id;
  const text = msg.text.trim().toLowerCase();

  // Se o usuário enviar "ping", respondemos "pong"
  const reply = text === "ping" ? "pong" : "Envie 'ping' para testar!";
  
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text: reply })
  });

  res.sendStatus(200);
});

// Inicia o servidor na porta que o Render fornece
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
