import express from "express";
import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";

const app = express();
app.use(express.json());

const prisma = new PrismaClient();
const TOKEN = process.env.BOT_TOKEN;
const API   = `https://api.telegram.org/bot${TOKEN}`;

app.post("/webhook", async (req, res) => {
  const update = req.body;
  console.log("→ Received update:", JSON.stringify(update));
  // ACK imediato
  res.sendStatus(200);

  // 1) Quando o bot for adicionado ao grupo
  if (update.my_chat_member) {
    const { new_chat_member, from, chat } = update.my_chat_member;
    // Se o bot virou MEMBER nesse chat
    if (new_chat_member.user.is_bot && new_chat_member.status === "member") {
      const chat_id = chat.id;
      const adminId = from.id;

      // Garante que o usuário admin existe no DB
      await prisma.user.upsert({
        where: { id: BigInt(adminId) },
        update: {},
        create: {
          id: BigInt(adminId),
          username: from.username,
          first_name: from.first_name,
          last_name: from.last_name,
        },
      });

      // Envia mensagem de boas-vindas com botão "Criar bag"
      const resp = await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          text: "👋 Olá! Não há nenhuma bag ativa neste grupo ainda.",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Criar bag", callback_data: "createBag" }],
            ]
          }
        })
      });
      const data = await resp.json();
      // Armazena o message_id para editar depois
      if (data.ok) {
        const welcome_message_id = data.result.message_id;
        // Você pode salvar welcome_message_id associado ao chat no DB
        await prisma.bag.upsert({
          where: { chat_id: BigInt(chat_id) },
          update: { welcome_message_id },
          create: {
            chat_id: BigInt(chat_id),
            name: "__temp__",           // placeholder até criar
            admin_user_id: BigInt(adminId),
            welcome_message_id,
          }
        });
      }
      return;
    }
  }

  // 2) Quando alguém clica em um inline button
  if (update.callback_query) {
    const { data, message, from } = update.callback_query;
    const chat_id = message.chat.id;
    const msg_id  = message.message_id;
    const user_id = from.id;

    // A) Criar a bag "teste" no DB
    if (data === "createBag") {
      // Atualiza o registro (que tinha placeholder) com um nome real
      const bag = await prisma.bag.update({
        where: { chat_id: BigInt(chat_id) },
        data: {
          name: "teste",
          admin_user_id: BigInt(user_id)
        }
      });

      // Edita a mensagem original para confirmar a criação
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
              [{ text: "👥 Entrar na bag", callback_data: "joinBag" }]
            ]
          }
        })
      });

      // Responde ao callback para tirar o loading no botão
      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: update.callback_query.id
        })
      });

      return;
    }

    // B) Entrar na bag
    if (data === "joinBag") {
      // Garante que o user existe
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
      // Busca bag pelo chat
      const bag = await prisma.bag.findUnique({ where: { chat_id: BigInt(chat_id) } });
      if (!bag) return;
      // Insere na bag_users se ainda não estiver
      await prisma.bagUser.upsert({
        where: {
          bagId_userId: {
            bagId: bag.id,
            userId: BigInt(user_id)
          }
        },
        update: {},
        create: {
          bagId: bag.id,
          userId: BigInt(user_id)
        }
      });
      // Recarrega lista de participantes
      const participants = await prisma.bagUser.findMany({
        where: { bagId: bag.id },
        include: { user: true }
      });
      const mentions = participants.map(p => {
        const u = p.user;
        return u.username ? `@${u.username}` : `[${u.first_name}](tg://user?id=${u.id})`;
      }).join(" ");

      // Edita mensagem para mostrar membros
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
              [{ text: "👥 Entrar na bag", callback_data: "joinBag" }]
            ]
          }
        })
      });

      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: update.callback_query.id,
          text: "Você entrou na bag!"
        })
      });

      return;
    }
  }

  // 3) Tratamento genérico de mensagens de texto
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
  } catch (err) {
    console.error("Error sending message:", err);
  }
});

// Health check
app.get("/healthz", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
