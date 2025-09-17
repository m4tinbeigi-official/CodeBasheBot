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

      if (url.pathname === '/webhook' && request.method === 'POST') {
        const update = await request.json();
        console.log("Webhook update received:", update);

        const chat = update.message?.chat;
        const messageId = update.message?.message_id;
        const sender = update.message?.from;

        if (chat && messageId && sender?.is_bot !== true && sender?.username !== BOT_USERNAME) {

          // --- 1. ارسال ری‌اکشن 👍 ---
          const reactionPayload = {
            chat_id: chat.id,
            message_id: messageId,
            reaction: [{ type: 'emoji', emoji: '👍' }],
            is_big: false
          };

          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMessageReaction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reactionPayload)
          });

          // --- 2. ارسال پیام تبلیغاتی فقط در پی وی ---
          if (chat.type === "private") {
            const autoMessage = `سلام! 👋\nبرای تبلیغ لطفا به @m4tinbeigipv پیام بدید و برای عضویت در گروه زیر کلیک کنید:`;

            const sendMessagePayload = {
              chat_id: chat.id,
              text: autoMessage,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "عضویت در گروه", url: "https://t.me/+8UV59QfeLSxmNjg0" }
                  ]
                ]
              }
            };

            const sendResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sendMessagePayload)
            });

            const result = await sendResponse.json();
            if (!result.ok) {
              console.error("Telegram API sendMessage error:", result.description);
              return new Response("Telegram API error", { status: 502 });
            }
          }
        }

        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal server error", { status: 500 });
    }
  }
};