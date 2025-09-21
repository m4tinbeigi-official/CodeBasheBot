export default {
  async fetch(request, env) {
    const BOT_TOKEN = env.BOT_TOKEN;
    const BOT_USERNAME = env.BOT_USERNAME;
    const REPORT_USER_ID = "1414726588"; // User ID for forwarding deleted messages
    const FORWARD_CHANNEL_ID = "-1003007964208"; // Hard-coded channel ID for forwarding popular posts

    if (!BOT_TOKEN || !BOT_USERNAME) {
      console.error("Missing required environment variables");
      return new Response("Server misconfigured", { status: 500 });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/webhook" && request.method === "POST") {
        const update = await request.json();
        console.log("Webhook update received:", update);

        const chat = update.message?.chat || update.message_reaction?.chat;
        const messageId = update.message?.message_id || update.message_reaction?.message_id;
        const sender = update.message?.from || update.message_reaction?.user;

        if (!chat || !messageId) {
          return new Response("Invalid update", { status: 400 });
        }

        // گرفتن لیست ادمین‌ها
        const adminsRes = await fetch(
          `https://api.telegram.org/bot${BOT_TOKEN}/getChatAdministrators?chat_id=${chat.id}`
        );
        const adminsData = await adminsRes.json();
        const admins = adminsData.result || [];
        const isAdmin = sender ? admins.some((admin) => admin.user.id === sender.id) : false;

        // --- 0. پردازش آپدیت‌های ری‌اکشن (فوروارد پست با 20+ ری‌اکشن) ---
        if (update.message_reaction) {
          const reactionUpdate = update.message_reaction;
          const reactionCountRes = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getMessageReactionCount?chat_id=${chat.id}&message_id=${messageId}`
          );
          const reactionData = await reactionCountRes.json();
          const totalReactions = reactionData.result?.total_reactions || 0;

          if (totalReactions >= 20) {
            // فوروارد پیام به کانال
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: FORWARD_CHANNEL_ID,
                from_chat_id: chat.id,
                message_id: messageId,
              }),
            });
            const senderName = sender.username ? `@${sender.username}` : sender.first_name || "کاربر";
            await sendLog(BOT_TOKEN, chat.id, `پیام ${messageId} از ${senderName} با ${totalReactions} ری‌اکشن به کانال ${FORWARD_CHANNEL_ID} فوروارد شد.`);
          }
          return new Response("Reaction processed", { status: 200 });
        }

        // --- 1. حذف پیام‌های سیستمی و خوش‌آمدگویی ---
        const isSystemMessage =
          update.message?.new_chat_members ||
          update.message?.left_chat_member ||
          update.message?.group_chat_created ||
          update.message?.new_chat_title ||
          update.message?.new_chat_photo ||
          update.message?.delete_chat_photo;

        if (isSystemMessage) {
          if (update.message?.new_chat_members) {
            const newMember = update.message.new_chat_members[0];
            const welcomeMessage = `سلام ${newMember.first_name}! 👋\nبه گروه کد خوش اومدید.\nقوانین:\n- فقط عکس/ویدیو کد با کپشن حداکثر 5 کلمه مجاز است.\n- لینک فقط توسط ادمین‌ها.\n- چت ممنوع! فقط کد.`;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: newMember.id,
                text: welcomeMessage,
                parse_mode: "HTML",
              }),
            });
          }
          await deleteMessage(BOT_TOKEN, chat.id, messageId);
          return new Response("System message deleted", { status: 200 });
        }

        // --- 2. حذف پیام‌های نامرتبط توسط غیرادمین (استیکر، گیف، صوت، فایل، فوروارد، متن خالی) ---
        if (
          !isAdmin &&
          (update.message.sticker ||
            update.message.animation ||
            update.message.voice ||
            update.message.document ||
            update.message.forward_date ||
            (update.message.text && !update.message.photo && !update.message.video))
        ) {
          await forwardDeletedMessage(BOT_TOKEN, REPORT_USER_ID, chat.id, messageId);
          await deleteMessage(BOT_TOKEN, chat.id, messageId);
          const senderName = sender.username ? `@${sender.username}` : sender.first_name || "کاربر";
          await sendLog(BOT_TOKEN, chat.id, `قوانین رو رعایت نکردی ${senderName} و پیامت حذف شد.`);
          return new Response("Irrelevant message deleted", { status: 200 });
        }

        // --- 3. چک کپشن عکس/ویدیو برای غیرادمین ---
        const text = update.message?.text || update.message?.caption || "";
        const entities = update.message?.entities || update.message?.caption_entities || [];
        if (!isAdmin && (update.message.photo || update.message.video) && update.message.caption) {
          const captionWords = update.message.caption.trim().split(/\s+/).length;
          if (captionWords > 5) {
            await forwardDeletedMessage(BOT_TOKEN, REPORT_USER_ID, chat.id, messageId);
            await deleteMessage(BOT_TOKEN, chat.id, messageId);
            const senderName = sender.username ? `@${sender.username}` : sender.first_name || "کاربر";
            await sendLog(BOT_TOKEN, chat.id, `قوانین رو رعایت نکردی ${senderName} و پیامت حذف شد.`);
            return new Response("Long caption deleted", { status: 200 });
          }
        }

        // --- 4. حذف لینک از غیرادمین ---
        const hasTextLink = /(https?:\/\/|t\.me\/|www\.|[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/|$))/i.test(text);
        const hasEntityLink = entities.some(
          (entity) =>
            entity.type === "url" ||
            entity.type === "text_link" ||
            (entity.type === "mention" && /t\.me\//i.test(text.slice(entity.offset, entity.offset + entity.length)))
        );

        if (hasTextLink || hasEntityLink) {
          if (!isAdmin) {
            await forwardDeletedMessage(BOT_TOKEN, REPORT_USER_ID, chat.id, messageId);
            await deleteMessage(BOT_TOKEN, chat.id, messageId);
            const senderName = sender.username ? `@${sender.username}` : sender.first_name || "کاربر";
            await sendLog(BOT_TOKEN, chat.id, `قوانین رو رعایت نکردی ${senderName} و پیامت حذف شد.`);
            return new Response("Non-admin link deleted", { status: 200 });
          }
        }

        // --- 5. فیلتر کلمات بد در کپشن/متن ---
        const badWords = ["فحش", "توهین", "اسپم"]; // لیست کلمات ممنوعه
        if (badWords.some((word) => text.toLowerCase().includes(word))) {
          if (!isAdmin) {
            await forwardDeletedMessage(BOT_TOKEN, REPORT_USER_ID, chat.id, messageId);
            await deleteMessage(BOT_TOKEN, chat.id, messageId);
            const senderName = sender.username ? `@${sender.username}` : sender.first_name || "کاربر";
            await sendLog(BOT_TOKEN, chat.id, `قوانین رو رعایت نکردی ${senderName} و پیامت حذف شد.`);
            return new Response("Bad word message deleted", { status: 200 });
          }
        }

        // --- 6. پردازش کامندهای ادمینی ---
        if (isAdmin && text.startsWith("/")) {
          const command = text.split(" ")[0];
          const args = text.split(" ").slice(1);

          if (command === "/stats") {
            const activeMembers = (await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMemberCount?chat_id=${chat.id}`)).json()).result;
            let statsMessage = `📊 آمار گروه:\nاعضای فعال: ${activeMembers}`;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chat.id,
                text: statsMessage,
              }),
            });
            return new Response("Stats command processed", { status: 200 });
          }

          if (command === "/pin_rules") {
            const rulesMessage = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chat.id,
                text: "📜 قوانین گروه کد:\n- فقط عکس/ویدیو کد با کپشن حداکثر 5 کلمه.\n- لینک فقط توسط ادمین.\n- چت ممنوع.",
              }),
            });
            const rulesData = await rulesMessage.json();
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/pinChatMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chat.id,
                message_id: rulesData.result.message_id,
                disable_notification: true,
              }),
            });
            return new Response("Rules pinned", { status: 200 });
          }
        }

        // --- 7. ری‌اکشن 👍 و پیام خودکار در چت خصوصی ---
        if (sender?.is_bot !== true && sender?.username !== BOT_USERNAME) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMessageReaction`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chat.id,
              message_id: messageId,
              reaction: [{ type: "emoji", emoji: "👍" }],
              is_big: false,
            }),
          });

          if (chat.type === "private") {
            const autoMessage = `سلام! 👋\nبرای تبلیغ لطفا به @m4tinbeigipv پیام بدید و برای عضویت در گروه زیر کلیک کنید:`;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chat.id,
                text: autoMessage,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "عضویت در گروه",
                        url: "https://t.me/+8UV59QfeLSxmNjg0",
                      },
                    ],
                  ],
                },
              }),
            });
          }
        }

        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal server error", { status: 500 });
    }
  },
};

// توابع کمکی
async function deleteMessage(token, chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
    }),
  });
}

async function sendLog(token, chatId, message) {
  const logMessage = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
  });
  const logData = await logMessage.json();
  const logMessageId = logData.result?.message_id;

  // حذف پیام لاگ بعد از 5 ثانیه
  if (logMessageId) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // تأخیر 5 ثانیه
    await deleteMessage(token, chatId, logMessageId);
  }
}

async function forwardDeletedMessage(token, reportUserId, chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${token}/forwardMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: reportUserId,
      from_chat_id: chatId,
      message_id: messageId,
    }),
  });
}