import { Module } from "../lib/plugins.js";
import axios from "axios";

Module({
  command: "cpost",
  aliases: ["cp"],
  fromMe: true,
  description: "Send a post to a WhatsApp channel",
  usage: ".cpost <channel_link> <text | url | reply>",
})(async (message, match) => {
  try {
    if (!match) return message.send("Usage: .cpost <channel_link> <text/url/reply>");

    await message.react("⌛");

    const args = match.trim().split(" ");
    const link = args.shift();
    const input = args.join(" ");

    // Extract invite code and resolve newsletter JID
    const id = link.match(/channel\/([A-Za-z0-9_-]+)/)?.[1];
    if (!id) return message.send("❌ Invalid channel link");

    const meta = await message.client.newsletterMetadata("invite", id);
    const jid = meta.id;

    let msg = null;

    // ── REPLY MODE ─────────────────────────────────────────────────────────
    if (message.reply_message) {
      const m = message.reply_message;
      let buffer;
      try { buffer = await message.client.downloadMediaMessage(m.message); } catch { /* ignore */ }
      if (!buffer) { try { buffer = await m.download(); } catch { /* ignore */ } }

      if (!buffer) return message.send("❌ Media download failed");

      if (m.mimetype?.startsWith("image")) {
        msg = { image: buffer, caption: input || "" };
      } else if (m.mimetype?.startsWith("audio")) {
        msg = { audio: buffer, mimetype: "audio/mpeg", ptt: false };
      } else if (m.text) {
        msg = { text: input || m.text };
      }
    }

    // ── URL MODE ───────────────────────────────────────────────────────────
    if (!msg && input.includes("http")) {
      const url = input.match(/https?:\/\/\S+/)?.[0];
      if (url) {
        const caption = input.replace(url, "").trim();
        const res = await axios.get(url, {
          responseType: "arraybuffer",
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        const buffer = Buffer.from(res.data);

        if (/\.(jpg|jpeg|png|webp)/i.test(url)) {
          msg = { image: buffer, caption: caption || "" };
        } else if (/\.(mp3|wav|m4a)/i.test(url)) {
          msg = { audio: buffer, mimetype: "audio/mpeg" };
        }
      }
    }

    // ── TEXT FALLBACK ──────────────────────────────────────────────────────
    if (!msg) msg = { text: input };

    // ── SEND ───────────────────────────────────────────────────────────────
    await message.client.newsletterSendMessage(jid, msg);
    await message.react("✅");
    return message.send("✅ Channel post sent");

  } catch (err) {
    console.error("[CPOST ERROR]", err);
    await message.react("❌");
    return message.send(`❌ Failed: ${err?.message || err}`);
  }
});
