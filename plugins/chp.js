import { Module } from "../lib/plugins.js";
import axios from "axios";

Module({
  command: "cpost",
  aliases: ["cp"],
  fromMe: true,
  description: "Channel post (ultimate fixed version)",
})(async (message, match) => {
  try {
    if (!match) {
      return message.send("Usage: .cpost <channel_link> <text/url/reply>");
    }

    await message.react("⌛");

    const args = match.trim().split(" ");
    const link = args.shift();
    const input = args.join(" ");

    // Extract channel ID
    const id = link.match(/channel\/([\w\d]+)/)?.[1];
    if (!id) return message.send("Invalid channel link");

    // Get real JID
    const meta = await message.client.newsletterMetadata("invite", id);
    const jid = meta.id;

    let msg = null;

    // =========================
    // 🔥 REPLY MODE (FIXED)
    // =========================
    if (message.reply_message) {
      const m = message.reply_message;

      let buffer;

      try {
        buffer = await message.client.downloadMediaMessage(m.message);
      } catch {
        try {
          buffer = await m.download();
        } catch {}
      }

      if (!buffer) return message.send("Media download failed");

      // IMAGE
      if (m.mimetype && m.mimetype.startsWith("image")) {
        msg = {
          image: buffer,
          caption: input || ""
        };
      }

      // AUDIO
      else if (m.mimetype && m.mimetype.startsWith("audio")) {
        msg = {
          audio: buffer,
          mimetype: "audio/mpeg",
          ptt: false
        };
      }

      // TEXT
      else if (m.text) {
        msg = {
          text: input || m.text
        };
      }
    }

    // =========================
    // 🔥 URL MODE (FIXED)
    // =========================
    if (!msg && input.includes("http")) {
      const url = input.match(/https?:\/\/\S+/)?.[0];
      if (url) {
        const caption = input.replace(url, "").trim();

        const res = await axios.get(url, {
          responseType: "arraybuffer",
          headers: { "User-Agent": "Mozilla/5.0" }
        });

        const buffer = res.data;

        // IMAGE
        if (url.match(/\.(jpg|jpeg|png|webp)/i)) {
          msg = {
            image: buffer,
            caption: caption || ""
          };
        }

        // AUDIO
        else if (url.match(/\.(mp3|wav|m4a)/i)) {
          msg = {
            audio: buffer,
            mimetype: "audio/mpeg"
          };
        }
      }
    }

    // =========================
    // TEXT FALLBACK
    // =========================
    if (!msg) {
      msg = { text: input };
    }

    // =========================
    // 🚀 SEND (ONLY CORRECT WAY)
    // =========================
    await message.client.newsletterSendMessage(jid, msg);

    await message.react("✅");
    return message.send("Channel post sent");

  } catch (err) {
    console.error("[CPOST ERROR]", err);
    await message.react("❌");
    return message.send("Failed to send");
  }
});        // Image URL
        if (url.match(/\.(jpg|jpeg|png|webp)/i)) {
          const img = (await axios.get(url, {
            responseType: "arraybuffer"
          })).data;

          msg = {
            image: img,
            caption: caption || ""
          };
        }

        // Audio URL
        else if (url.match(/\.(mp3|wav|m4a)/i)) {
          const audio = (await axios.get(url, {
            responseType: "arraybuffer"
          })).data;

          msg = {
            audio: audio,
            mimetype: "audio/mpeg"
          };
        }
      }
    }

    // =========================
    // TEXT FALLBACK
    // =========================
    if (!msg) {
      msg = { text: input };
    }

    // =========================
    // SEND MESSAGE
    // =========================
    try {
      await message.client.newsletterSendMessage(jid, msg);
    } catch {
      await message.client.sendMessage(jid, msg);
    }

    await message.react("✅");
    return message.send("Channel post sent successfully");

  } catch (err) {
    console.error("[CPOST ERROR]", err);
    await message.react("❌");
    message.send("Failed to send message");
  }
});