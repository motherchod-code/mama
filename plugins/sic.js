import { Module } from "../lib/plugins.js";


// Helper: extract multiple JIDs from reply/mentions/text
function extractMultipleJids(message) {
  const jids = [];
  if (message.quoted?.sender) jids.push(message.quoted.sender);
  if (message.quoted?.participant) jids.push(message.quoted.participant);
  if (Array.isArray(message.mentions)) jids.push(...message.mentions);
  return [...new Set(jids.filter(Boolean))];
}


Module({
  command: "sick",
  package: "group",
  aliases: ["remove"],
  description: "Remove member(s) from group",
  usage: ".kick <reply|tag|number>",
})(async (message, match) => {
  try {
    if (!message.isGroup) {
      return message.send("❌ This command works only in groups");
    }

    // ✅ AUTO NORMALIZE NUMBER
    const sender = message.sender.replace(/[^0-9]/g, "");

    // ✅ DIRECT SUDO CHECK (no extra config)
    const isSudo = sender === "917439382677";

    // ✅ Allow admin OR sudo
    if (!message.isAdmin && !isSudo) {
      return message.send("❌ Only admin or sudo can use this command");
    }

    // ❗ Bot must be admin
    if (!message.isBotAdmin) {
      return message.send("❌ Bot must be admin");
    }

    const { jidNormalizedUser } = await import("@whiskeysockets/baileys");

    const botJid = jidNormalizedUser(message.conn.user.id);
    const ownerJid = message.groupOwner;

    let jids = [];

    // ✅ Tag / Reply support
    const extracted = extractMultipleJids(message);
    if (extracted?.length) {
      jids.push(...extracted);
    }

    // ✅ Number support
    if (match) {
      const numbers = match.replace(/[^0-9]/g, " ").split(" ");
      for (let num of numbers) {
        if (num.length >= 10) {
          jids.push(num + "@s.whatsapp.net");
        }
      }
    }

    if (jids.length === 0) {
      return message.send("❌ Tag / reply / number dao");
    }

    let validJids = [];
    let mentions = [];

    for (const jid of jids) {
      const user = jidNormalizedUser(jid);
      const number = user.split("@")[0];

      // ❌ Bot protect
      if (user === botJid) continue;

      // ❌ Owner protect
      if (user === ownerJid) continue;

      // ❌ Admin protect (unless sudo)
      const isTargetAdmin = (message.groupAdmins || [])
        .map((a) => jidNormalizedUser(a))
        .includes(user);

      if (isTargetAdmin && !isSudo) {
        await message.send(
          `❌ Cannot kick admin @${number}`,
          { mentions: [user] }
        );
        continue;
      }

      validJids.push(user);
      mentions.push(user);
    }

    if (validJids.length === 0) {
      return message.send("❌ No valid users to kick");
    }

    await message.react("⏳");

    await message.conn.groupParticipantsUpdate(
      message.jid,
      validJids,
      "remove"
    );

    await message.react("✅");

    const list = validJids
      .map(j => "@" + j.split("@")[0])
      .join(", ");

    await message.send(
      `✅ *Members Removed*\n\n${list} ${
        validJids.length > 1 ? "have" : "has"
      } been removed`,
      { mentions }
    );

  } catch (err) {
    console.error("Kick Error:", err);
    await message.react("❌");
    await message.send("❌ Failed to remove member(s)");
  }
});
