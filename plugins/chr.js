import { Module } from "../lib/plugins.js";

// 🔥 Multiple font styles
const styles = {
  bubble: {
    a: '🅐', b: '🅑', c: '🅒', d: '🅓', e: '🅔', f: '🅕',
    g: '🅖', h: '🅗', i: '🅘', j: '🅙', k: '🅚', l: '🅛',
    m: '🅜', n: '🅝', o: '🅞', p: '🅟', q: '🅠', r: '🅡',
    s: '🅢', t: '🅣', u: '🅤', v: '🅥', w: '🅦', x: '🅧',
    y: '🅨', z: '🅩',
    '0': '⓿','1': '➊','2': '➋','3': '➌','4': '➍',
    '5': '➎','6': '➏','7': '➐','8': '➑','9': '➒'
  },

  small: {
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ',
    f: 'ғ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ',
    k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ',
    p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ',
    u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
  }
};

// 🔧 Convert text
function stylize(text, styleName = "bubble") {
  const map = styles[styleName] || styles.bubble;

  return text.split('').map(ch => {
    if (ch === ' ') return '⠀';
    return map[ch.toLowerCase()] || ch;
  }).join('');
}

Module({
  command: "chr",
  aliases: ["fancyreact", "chr"],
  fromMe: true,
  description: "React to WhatsApp Channel messages with fancy text",
})(async (message, match) => {
  try {
    if (!match) {
      return message.send(
        "❌ Usage:\n.freact [style] link text\n\nExample:\n.freact bubble https://whatsapp.com/channel/xxx/yyy hello"
      );
    }

    await message.react("⌛");

    const args = match.trim().split(" ");
    let style = "bubble";

    // 🎨 Detect style
    if (styles[args[0]]) {
      style = args.shift();
    }

    const link = args.shift();
    const inputText = args.join(" ");

    if (!link || !link.includes("whatsapp.com/channel/")) {
      await message.react("❌");
      return message.send("❌ Invalid channel link");
    }

    if (!inputText) {
      await message.react("❌");
      return message.send("❌ Text দাও bro");
    }

    // 🔤 Convert text
    const emojiText = stylize(inputText, style);

    // 🔗 Extract IDs
    const matchLink = link.match(/channel\/([\w\d]+)\/([\w\d]+)/);
    if (!matchLink) {
      await message.react("❌");
      return message.send("❌ Link format ভুল");
    }

    const [, channelId, messageId] = matchLink;

    const meta = await message.client.newsletterMetadata("invite", channelId);

    await message.client.newsletterReactMessage(
      meta.id,
      messageId,
      emojiText
    );

    await message.react("✅");

    return message.send(
      `✅ *Reaction Sent!*\n\n` +
      `📣 *Channel:* ${meta.name}\n` +
      `🎨 *Style:* ${style}\n` +
      `🔤 *Text:* ${emojiText}`
    );

  } catch (err) {
    console.error("[FANCY REACT ERROR]", err);
    await message.react("❌");

    message.send("⚠️ Failed! Link invalid বা permission নাই");
  }
});
