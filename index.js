import express from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
app.use(express.json());

const prisma = new PrismaClient();
const TOKEN = process.env.BOT_TOKEN;
const API   = `https://api.telegram.org/bot${TOKEN}`;

app.post("/webhook", async (req, res) => {
  const update = req.body;
  console.log("→ Received update:", JSON.stringify(update));
  res.sendStatus(200);

  // 1) Bot adicionado ao grupo
  if (update.my_chat_member) {
    const { new_chat_member, from, chat } = update.my_chat_member;
    if (new_chat_member.user.is_bot && new_chat_member.status === "member") {
      const chat_id = chat.id;
      const admin_id = from.id;

      // upsert do admin em users
      await prisma.user.upsert({
        where: { id: BigInt(admin_id) },
        update: {},
        create: {
          id: BigInt(admin_id),
          username: from.username,
          first_name: from.first_name,
          last_name: from.last_name,
        },
      });

      // 1.1) envia mensagem inicial sem botão WebApp
      let welcome_message_id;
      const resp = await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          text: "👋 Olá! Não há nenhuma bag ativa neste grupo ainda.",
        }),
      });
      const data = await resp.json();
      if (!data.ok) return;
      welcome_message_id = data.result.message_id;

      // 1.2) monta a URL agora que temos welcome_message_id
      const webAppUrl = `https://hackaton-mini-app-nine.vercel.app/create?chat_id=${chat_id}&msg_id=${welcome_message_id}&admin_id=${admin_id}`;

      // 1.3) edita o reply_markup para incluir o botão WebApp
      await fetch(`${API}/editMessageReplyMarkup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          message_id: welcome_message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Criar bag", web_app: { url: webAppUrl } }],
            ],
          },
        }),
      });

      // 1.4) salva no DB
      await prisma.bag.upsert({
        where: { chat_id: BigInt(chat_id) },
        update: { welcome_message_id },
        create: {
          chat_id: BigInt(chat_id),
          name: "__temp__",
          admin_user_id: BigInt(admin_id),
          welcome_message_id,
        },
      });

      return;
    }
  }

  // 2) CallbackQuery handler
  if (update.callback_query) {
    const { data, message, from, id: callback_query_id } = update.callback_query;
    const chat_id = message.chat.id;
    const msg_id = message.message_id;
    const user_id = from.id;

    // A) createBag
    if (data === "createBag") {
      const bag = await prisma.bag.update({
        where: { chat_id: BigInt(chat_id) },
        data: {
          name: "teste",
          admin_user_id: BigInt(user_id),
        },
      });

      // edita a mensagem original
      await fetch(`${API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          message_id: msg_id,
          text: `🎉 Bag *${bag.name}* criada com sucesso!\n\nQuem quiser participar, clique em “Entrar na bag”.`,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "👥 Entrar na bag", callback_data: "joinBag" }],
            ],
          },
        }),
      });

      // limpa loading do botão
      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id }),
      });

      return;
    }

    // B) joinBag
    if (data === "joinBag") {
      // garante user em users
      await prisma.user.upsert({
        where: { id: BigInt(user_id) },
        update: {},
        create: {
          id: BigInt(user_id),
          username: from.username,
          first_name: from.first_name,
          last_name: from.last_name,
        },
      });

      // busca a bag
      const bag = await prisma.bag.findUnique({
        where: { chat_id: BigInt(chat_id) },
      });
      if (!bag) return;

      // adiciona em bag_users
      await prisma.bagUser.upsert({
        where: {
          bag_id_user_id: {
            bag_id: bag.id,
            user_id: BigInt(user_id),
          },
        },
        update: {},
        create: {
          bag_id: bag.id,
          user_id: BigInt(user_id),
        },
      });

      // retira lista de participantes
      const participants = await prisma.bagUser.findMany({
        where: { bag_id: bag.id },
        include: { user: true },
      });
      const mentions = participants
        .map((p) => {
          const u = p.user;
          return u.username
            ? `@${u.username}`
            : `[${u.first_name}](tg://user?id=${u.id})`;
        })
        .join(" ");

      // edita mensagem para mostrar quem já entrou
      await fetch(`${API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          message_id: msg_id,
          text: `🎉 Bag *${bag.name}*\n\nParticipantes:\n${mentions}`,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "👥 Entrar na bag", callback_data: "joinBag" }],
            ],
          },
        }),
      });

      // confirma pro usuário
      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id,
          text: "Você entrou na bag!",
        }),
      });

      return;
    }
  }

  // 3) Fallback de texto
  const msg = update.message;
  if (!msg?.text) return;
  const chat_id = msg.chat.id;
  const text = msg.text.trim().toLowerCase();
  const reply = text === "ping" ? "pong" : "Envie 'ping' para testar!";

  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text: reply }),
  });
});

app.get("/healthz", (_, res) => res.send("OK"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
