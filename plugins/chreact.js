// plugins/chreact.js
// .chreact <channel_post_link> emoji1,emoji2,emoji3
// Reacts to a channel post from ALL connected sessions

import { Module } from "../lib/plugins.js";
import { manager } from "../lib/client.js";

/**
 * Parse a WhatsApp channel/newsletter post link.
 *
 * Supported formats:
 *  https://whatsapp.com/channel/INVITE_CODE              → need to resolve JID
 *  https://www.whatsapp.com/channel/NEWSLETTER_JID/POST_MSG_ID
 *  120363406945984225@newsletter                          → raw JID (no msgId)
 *
 * Returns { channelJid, msgId, inviteCode }
 */
function parseChannelLink(input) {
  // Raw newsletter JID  e.g. 120363406945984225@newsletter
  if (/@newsletter$/.test(input.trim())) {
    return { channelJid: input.trim(), msgId: null, inviteCode: null };
  }

  // Full post link with newsletter JID in path
  // e.g. https://www.whatsapp.com/channel/120363406945984225@newsletter/POSTID
  const fullMatch = input.match(
    /channel\/([\d]+@newsletter)(?:\/([A-Za-z0-9_\-]+))?/
  );
  if (fullMatch) {
    return {
      channelJid: fullMatch[1],
      msgId: fullMatch[2] || null,
      inviteCode: null,
    };
  }

  // Invite-code link  e.g. https://whatsapp.com/channel/ABC123XYZ
  const inviteMatch = input.match(/channel\/([A-Za-z0-9_\-]{10,})/);
  if (inviteMatch) {
    return {
      channelJid: null,
      msgId: null,
      inviteCode: inviteMatch[1],
    };
  }

  return null;
}

Module({
  command: "chreact",
  aliases: ["creact", "chanreact"],
  fromMe: true,
  description: "React to a channel post from all connected sessions",
  usage: ".chreact <channel_post_link> emoji1,emoji2,...",
})(async (message, match) => {
  try {
    if (!match) {
      return message.send(
        `*📌 Usage:*\n.chreact <channel_post_link> emoji1,emoji2,...\n\n` +
        `*Examples:*\n` +
        `.chreact https://whatsapp.com/channel/120363406945984225@newsletter/299 ❤️,🔥,😍\n` +
        `.chreact 120363406945984225@newsletter ❤️‍🩹,😭\n\n` +
        `_Reacts from ALL connected sessions simultaneously._`
      );
    }

    await message.react("⌛");

    // Split on whitespace: first token = link, rest = emoji list
    const parts = match.trim().split(/\s+/);
    const linkRaw = parts[0];
    const emojiRaw = parts.slice(1).join(" ");

    // Parse emojis — comma or space separated
    const emojis = emojiRaw
      ? emojiRaw
          .split(/[,，\s]+/)
          .map((e) => e.trim())
          .filter(Boolean)
      : ["❤️", "🔥", "😍"];

    if (!emojis.length) {
      return message.send("❌ Please provide at least one emoji.\n\nExample: .chreact <link> ❤️,🔥,😭");
    }

    const parsed = parseChannelLink(linkRaw);
    if (!parsed) {
      return message.send(
        "❌ Could not parse channel link.\n\nSupported formats:\n" +
        "• https://whatsapp.com/channel/120363...@newsletter/POST_ID\n" +
        "• 120363...@newsletter"
      );
    }

    // Get all active sessions from manager
    const sessions = manager.list().filter((s) => manager.isRunning(s));
    if (!sessions.length) {
      return message.send("❌ No active sessions connected.");
    }

    // Resolve channelJid from invite code if needed (use first available session)
    let channelJid = parsed.channelJid;
    if (!channelJid && parsed.inviteCode) {
      const firstEntry = manager.sessions.get(sessions[0]);
      if (!firstEntry?.sock) return message.send("❌ No active socket found.");
      try {
        const meta = await firstEntry.sock.newsletterMetadata("invite", parsed.inviteCode);
        channelJid = meta?.id;
      } catch (e) {
        return message.send(`❌ Could not resolve channel: ${e?.message || e}`);
      }
    }

    if (!channelJid) return message.send("❌ Could not determine channel JID.");

    const msgId = parsed.msgId;

    await message.send(
      `⚡ *Reacting to channel post...*\n` +
      `📢 Channel: \`${channelJid}\`\n` +
      `🆔 Post ID: ${msgId || "_will use latest_"}\n` +
      `😀 Emojis: ${emojis.join("  ")}\n` +
      `📱 Sessions: ${sessions.length}`
    );

    let successCount = 0;
    let failCount = 0;

    // React from all sessions in parallel
    await Promise.allSettled(
      sessions.map(async (sessionId) => {
        const entry = manager.sessions.get(sessionId);
        if (!entry?.sock) return;
        const sock = entry.sock;

        // Pick a random emoji from the provided list
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];

        try {
          if (msgId) {
            // We have the exact post ID — direct react
            await sock.newsletterReactMessage(channelJid, msgId, emoji);
          } else {
            // No post ID in link — follow channel first, then react latest
            try { await sock.newsletterFollow(channelJid); } catch { /* ignore */ }
            // Try to fetch latest message metadata
            const msgs = await sock.fetchMessagesFromWAServer(channelJid, 1).catch(() => null);
            const latestId = msgs?.[0]?.key?.id;
            if (!latestId) throw new Error("Could not get latest post ID");
            await sock.newsletterReactMessage(channelJid, latestId, emoji);
          }
          successCount++;
          console.log(`[chreact] ✅ ${sessionId} → ${emoji}`);
        } catch (e) {
          failCount++;
          console.log(`[chreact] ❌ ${sessionId}: ${e?.message}`);
        }
      })
    );

    await message.react(successCount > 0 ? "✅" : "❌");

    return message.send(
      `*✅ Channel React Done!*\n\n` +
      `📢 Channel: \`${channelJid}\`\n` +
      `😀 Emojis used: ${emojis.join("  ")}\n` +
      `✅ Success: ${successCount}/${sessions.length} sessions\n` +
      (failCount > 0 ? `❌ Failed: ${failCount} sessions` : "")
    );

  } catch (err) {
    console.error("[chreact ERROR]", err);
    await message.react("❌");
    return message.send(`❌ Error: ${err?.message || err}`);
  }
});
