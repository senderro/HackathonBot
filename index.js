import express from "express";
import { PrismaClient, ChatState } from "@prisma/client";

const app = express();
app.use(express.json());

const prisma = new PrismaClient();
const TOKEN = process.env.BOT_TOKEN;
const API   = `https://api.telegram.org/bot${TOKEN}`;

app.post("/webhook", async (req, res) => {
  const update = req.body;
  console.log("→ Received update keys:", Object.keys(update));
  console.log("→ Full update:", JSON.stringify(update));
  res.sendStatus(200);

  // ── 1) Bot adicionado no grupo ──────────────────────────────────────────────
  if (update.my_chat_member) {
    const { new_chat_member, from, chat } = update.my_chat_member;
    console.log("my_chat_member event:", chat.id, new_chat_member.status);
    if (new_chat_member.user.is_bot && new_chat_member.status === "member") {
      const chat_id  = chat.id;
      const admin_id = from.id;
        console.log("Bot entrou no grupo", chat_id, "por admin", admin_id);
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
console.log("Bag after upsert:", bag);
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
      const userInDb = await prisma.user.upsert({
            where: { id: BigInt(user_id) },
            update: {},
            create: {
              id: BigInt(user_id),
              username: from.username,
              first_name: from.first_name,
              last_name: from.last_name,
            },
          });
      // Se não tem carteira, avisar e interromper
      if (!userInDb.wallet_address) {
        await fetch(`${API}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id,
            text: "❌ Você precisa conectar uma carteira antes de entrar na bag.",
            show_alert: true,
          }),
        });

        await fetch(`${API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id,
            text: `⚠️ <a href="tg://user?id=${user_id}">${from.first_name}</a>, para entrar na bag você precisa primeiro conectar uma carteira no mini app.\n\nClique no meu perfil e em seguida toque em "Abrir App". Vá até a aba "Perfil" no aplicativo e conecte sua carteira TON.`,
            parse_mode: "HTML",
          }),
        });

        return;
      }

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
  if (!bag) {
    console.warn("Nenhuma bag encontrada para chat_id", chat_id);
    return;
  }

  if (bag.state === ChatState.AWAITING_NAME && msg.from.id === Number(bag.admin_user_id)) {
      const nome = msg.text.trim();

      // 1️⃣ Salva nome e atualiza estado
      await prisma.bag.update({
        where: { chat_id: BigInt(chat_id) },
        data: {
          name: nome,
          state: ChatState.BAG_CREATED,
        },
      });

      // 2️⃣ Notifica criação da bag
      await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
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
  if (bag.state === ChatState.BAG_CREATED && msg.text.trim().toLowerCase().startsWith("/g")) {
  // 1️⃣ Registrar transação local
  await prisma.transaction.create({
    data: {
      bag_id: bag.id,
      user_id: BigInt(msg.from.id),
      message_text: msg.text,
    },
  });

  // 2️⃣ Preparar payload com apenas IDs como nomes
  const participants = await prisma.bagUser.findMany({
    where: { bag_id: bag.id },
    include: { user: true },
  });

  const usuarios = {};
  const gastos = {};

  participants.forEach(p => {
    const uid = p.user_id.toString();
    usuarios[uid] = uid; // nome é o próprio id
    gastos[uid] = p.total_spent || 0;
  });

  const ultima_transacao = {
    usuario_id: msg.from.id.toString(),
    descricao: msg.text,
  };

  // 3️⃣ Chamada à API externa
  const resp = await fetch("https://hackatonllm-production.up.railway.app/newtransaction", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EXTERNAL_API_TOKEN}`,
    },
    body: JSON.stringify({ usuarios, gastos, ultima_transacao }),
  });

  const json = await resp.json();
  console.log("API response:", json);

  // 4️⃣ Atualizar gastos no DB
  if (json.gastos) {
    for (const uid in json.gastos) {
      await prisma.bagUser.update({
        where: {
          bag_id_user_id: {
            bag_id: bag.id,
            user_id: BigInt(uid),
          },
        },
        data: { total_spent: json.gastos[uid] },
      });
    }
  }

  // 5️⃣ Enviar confirmação da transação
  const descricao = msg.text;
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id,
      text: `Transação registrada:\n<a href="tg://user?id=${msg.from.id}">${msg.from.first_name}</a>: ${descricao}`,
      parse_mode: "HTML",
    }),
  });

  return;
}
  if (msg.text.trim().toLowerCase() === "/finalizar") {
    console.log("Comando /finalizar recebido no chat", chat_id);

    const bag = await prisma.bags.findUnique({
      where: { chat_id: BigInt(chat_id) },
    });
    if (!bag || bag.state !== ChatState.BAG_CREATED) {
      await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          text: "❌ Não há nenhuma bag ativa para finalizar. Use após criar a bag e registrar transações.",
        }),
      });
      return;
    }

    // 1) coleta participantes do DB
    const participants = await prisma.bag_users.findMany({
      where: { bag_id: bag.id },
      include: { users: true },
    });

    // 2) monta payload para a API externa
    const usuarios = {};
    const gastos = {};
    participants.forEach(p => {
      const uid = p.user_id.toString();
      usuarios[uid] = p.users.first_name || p.users.username || uid;
      gastos[uid]   = p.total_spent || 0;
    });

    console.log("Payload /splitbill", { usuarios, gastos });

    // 3) chama a API de split
    const resp = await fetch("https://hackatonllm-production.up.railway.app/splitbill", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.EXTERNAL_API_TOKEN}`,
      },
      body: JSON.stringify({ usuarios, gastos }),
    });
    const json = await resp.json();
    console.log("Resposta /splitbill:", json);

    // 4) monta a mensagem de resumo
    let msgText = "📊 *Resumo final da bag*\n\n";
    msgText += "*Quem deve pagar a quem:*\n";
    if (Array.isArray(json.transacoes_por_pessoa)) {
      json.transacoes_por_pessoa.forEach((t) => {
        // t.de e t.para são as chaves em `usuarios`
        const nameDe   = usuarios[t.de]   || t.de;
        const namePara = usuarios[t.para] || t.para;
        msgText += `• *${nameDe}* → *${namePara}*: R$ ${t.valor.toFixed(2)}\n`;
      });
    }
    msgText += `\n*Gasto total:* R$ ${json.total_gastos.toFixed(2)}`;

    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text: msgText,
        parse_mode: "Markdown",
      }),
    });

    // 5) cria os pending_payments no DB
    for (const t of json.transacoes_por_pessoa || []) {
      await prisma.pending_payments.create({
        data: {
          bag_id:           bag.id,
          user_id_from:     BigInt(t.de),
          user_id_to:       BigInt(t.para),
          valor:            t.valor,        // Decimal(10,2)
          pago:             false,
          data_pagamento:   null,
          pollAttempts:     0,
          txHash:           null,
          user_to_address:  null,
        },
      });
    }

    return;
  }


  
});

app.get("/healthz", (_, res) => res.send("OK"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
