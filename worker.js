export default {
  async fetch(request, env) {
    const BOT_TOKEN = env.BOT_TOKEN;
    const BOT_USERNAME = env.BOT_USERNAME;

    if (!BOT_TOKEN || !BOT_USERNAME) {
      console.error("Missing required environment variables");
      return new Response("Server misconfigured", { status: 500 });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/webhook" && request.method === "POST") {
        const update = await request.json();
        console.log("Webhook update received:", update);

        const chat = update.message?.chat;
        const messageId = update.message?.message_id;
        const sender = update.message?.from;

        // --- 0. حذف پیام‌های سیستمی ---
        const isSystemMessage =
          update.message?.new_chat_members ||
          update.message?.left_chat_member ||
          update.message?.group_chat_created ||
          update.message?.new_chat_title ||
          update.message?.new_chat_photo ||
          update.message?.delete_chat_photo;

        if (chat && messageId && isSystemMessage) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chat.id,
              message_id: messageId,
            }),
          });
          return new Response("System message deleted", { status: 200 });
        }

        // --- 0.5. حذف لینک از غیرادمین ---
        if (chat && messageId && update.message) {
          // بررسی انواع محتوا (متن، کپشن، نهادها)
          const textContent =
            update.message.text || update.message.caption || "";
          const entities = update.message.entities || update.message.caption_entities || [];

          // شناسایی لینک‌ها در متن یا کپشن
          const hasTextLink = /(https?:\/\/|t\.me\/|www\.|[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/|$))/i.test(textContent);

          // شناسایی لینک‌ها در نهادها (مانند لینک‌های فرمت‌شده)
          const hasEntityLink = entities.some(
            (entity) =>
              entity.type === "url" ||
              entity.type === "text_link" ||
              (entity.type === "mention" && /t\.me\//i.test(textContent.slice(entity.offset, entity.offset + entity.length)))
          );

          // اگر لینک در متن، کپشن یا نهادها وجود داشت
          if (hasTextLink || hasEntityLink) {
            // گرفتن لیست ادمین‌ها
            const adminsRes = await fetch(
              `https://api.telegram.org/bot${BOT_TOKEN}/getChatAdministrators?chat_id=${chat.id}`
            );
            const adminsData = await adminsRes.json();
            const admins = adminsData.result || [];

            const isAdmin = admins.some(
              (admin) => admin.user.id === sender?.id
            );

            if (!isAdmin) {
              await fetch(
                `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: chat.id,
                    message_id: messageId,
                  }),
                }
              );
              return new Response("Non-admin link deleted", { status: 200 });
            }
          }
        }

        // --- 1. ری‌اکشن 👍 و پیام خودکار ---
        if (
          chat &&
          messageId &&
          sender?.is_bot !== true &&
          sender?.username !== BOT_USERNAME
        ) {
          // ری‌اکشن 👍
          const reactionPayload = {
            chat_id: chat.id,
            message_id: messageId,
            reaction: [{ type: "emoji", emoji: "👍" }],
            is_big: false,
          };

          await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/setMessageReaction`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(reactionPayload),
            }
          );

          // پیام تبلیغاتی فقط در پی وی
          if (chat.type === "private") {
            const autoMessage = `سلام! 👋\nبرای تبلیغ لطفا به @m4tinbeigipv پیام بدید و برای عضویت در گروه زیر کلیک کنید:`;

            const sendMessagePayload = {
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
            };

            await fetch(
              `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(sendMessagePayload),
              }
            );
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