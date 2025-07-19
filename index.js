import express from "express";
import { PrismaClient, ChatState } from "@prisma/client";

const app = express();
app.use(express.json());

const prisma = new PrismaClient();
const TOKEN = process.env.BOT_TOKEN;
const API   = `https://api.telegram.org/bot${TOKEN}`;

app.post("/webhook", async (req, res) => {
  const update = req.body;
  console.log("→ Received update:", JSON.stringify(update));
  res.sendStatus(200);

  // ── 1) Bot adicionado no grupo ──────────────────────────────────────────────
  if (update.my_chat_member) {
    const { new_chat_member, from, chat } = update.my_chat_member;
    if (new_chat_member.user.is_bot && new_chat_member.status === "member") {
      const chat_id  = chat.id;
      const admin_id = from.id;

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

      let bag = await prisma.bag.upsert({
        where: { chat_id: BigInt(chat_id) },
        update: {},
        create: {
          chat_id: BigInt(chat_id),
          admin_user_id: BigInt(admin_id),
          name: "",
          welcome_message_id: 0,
          state: ChatState.BOT_ADDED,
        },
      });

      // Envia mensagem conforme estado
      if (
        bag.state === ChatState.BOT_ADDED ||
        bag.state === ChatState.AWAITING_CREATE
      ) {
        const resp = await fetch(`${API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id,
            text: "👋 Olá! Não há nenhuma bag ativa neste grupo ainda.",
            reply_markup: {
              inline_keyboard: [
                [{ text: "➕ Criar bag", callback_data: "createBag" }],
              ],
            },
          }),
        });
        const data = await resp.json();
        if (data.ok) {
          await prisma.bag.update({
            where: { chat_id: BigInt(chat_id) },
            data: {
              welcome_message_id: data.result.message_id,
              state: ChatState.AWAITING_CREATE,
            },
          });
        }
      } else if (bag.state === ChatState.BAG_CREATED) {
        await fetch(`${API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id,
            text: `🎉 Bag *${bag.name}* já criada!`,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "👥 Entrar na bag", callback_data: "joinBag" }],
              ],
            },
          }),
        });
      }

      return;
    }
  }

  // ── 2) CallbackQuery handler ─────────────────────────────────────────────────
  if (update.callback_query) {
    const { data, message, from, id: callback_query_id } = update.callback_query;
    const chat_id = message.chat.id;
    const msg_id = message.message_id;
    const user_id = from.id;

    const bag = await prisma.bag.findUnique({
      where: { chat_id: BigInt(chat_id) },
    });
    if (!bag) return;

    // A) createBag
    if (data === "createBag" && bag.state === ChatState.AWAITING_CREATE) {
      await fetch(`${API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          message_id: msg_id,
          text: "Por favor, me envie o *nome da bag*.",
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        }),
      });

      await prisma.bag.update({
        where: { chat_id: BigInt(chat_id) },
        data: { state: ChatState.AWAITING_NAME },
      });

      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id }),
      });

      return;
    }

    // B) joinBag
    if (data === "joinBag" && bag.state === ChatState.BAG_CREATED) {
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

  // ── 3) Mensagens de texto ─────────────────────────────────────────────────────
  const msg = update.message;
  if (!msg?.text) return;
  const chat_id = msg.chat.id;

  const bag = await prisma.bag.findUnique({
    where: { chat_id: BigInt(chat_id) },
  });
  if (bag?.state === ChatState.AWAITING_NAME && msg.from.id === Number(bag.admin_user_id)) {
    const nome = msg.text.trim();

    await prisma.bag.update({
      where: { chat_id: BigInt(chat_id) },
      data: {
        name: nome,
        state: ChatState.BAG_CREATED,
      },
    });

    const welcome_message_id = bag.welcome_message_id;
    await fetch(`${API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        message_id: welcome_message_id,
        text: `🎉 Bag *${nome}* criada com sucesso!\n\nQuem quiser participar, clique em “Entrar na bag”.`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "👥 Entrar na bag", callback_data: "joinBag" }],
          ],
        },
      }),
    });

    return;
  }

  // Fallback (ping)
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
