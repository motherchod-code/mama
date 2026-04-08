// plugins/csong.js

import axios from "axios";
import yts from "yt-search";
import { Module } from "../lib/plugins.js";

async function resolveChannelJid(client, input) {
  if (input.includes("@newsletter")) return input;

  const inviteMatch = input.match(/channel\/([\w\d]+)/);
  if (inviteMatch) {
    const meta = await client.newsletterMetadata("invite", inviteMatch[1]);
    return meta.id;
  }

  throw new Error("Invalid channel JID or link");
}

async function searchYouTube(query) {
  const res = await yts(query);
  return res.videos?.[0] || null;
}

async function fetchAudioUrl(youtubeUrl) {
  const apiUrl =
    "https://api-aswin-sparky.koyeb.app/api/downloader/song?search=" +
    encodeURIComponent(youtubeUrl);

  const { data } = await axios.get(apiUrl, { timeout: 30000 });

  if (!data?.status || !data?.data?.url) return null;
  return data.data;
}

Module({
  command: "chsong",
  aliases: ["cs"],
  fromMe: true,
  description: "Song → WhatsApp Channel",
})(async (message, match) => {
  try {
    if (!match || match.trim().split(" ").length < 2) {
      return message.send("❌ Usage:\n.csong song name channel_link");
    }

    const parts = match.trim().split(" ");
    const channelInput = parts.pop();
    const songQuery = parts.join(" ");

    await message.react("🔍");

    const video = await searchYouTube(songQuery);
    if (!video) return message.send("❌ Song not found");

    const channelJid = await resolveChannelJid(
      message.client,
      channelInput
    );

    await message.react("⬇️");

    const audioData = await fetchAudioUrl(video.url);
    if (!audioData) return message.send("❌ API failed");

    // 🔥 Premium Caption
    const caption = `╭━━━〔 🎧 𝗡𝗢𝗪 𝗣𝗟𝗔𝗬𝗜𝗡𝗚 〕━━━⬣
┃ 🎵 ${audioData.title || video.title}
┃ 👤 ${video.author.name}
┃ ⏱️ ${video.timestamp}
┃
┃ 🚀 Powered by Rabbit XMD
╰━━━━━━━━━━━━━━━━━━━⬣`;

    // audio buffer
    const audioBuf = (
      await axios.get(audioData.url, {
        responseType: "arraybuffer",
      })
    ).data;

    // thumbnail buffer
    let thumbBuf = null;
    try {
      thumbBuf = (
        await axios.get(video.thumbnail, {
          responseType: "arraybuffer",
        })
      ).data;
    } catch {}

    // 🔥 1. Thumbnail + Caption
    if (thumbBuf) {
      await message.client.newsletterSendMessage(channelJid, {
        image: Buffer.from(thumbBuf),
        caption,
      });
    } else {
      await message.client.newsletterSendMessage(channelJid, {
        text: caption,
      });
    }

    // 🔥 2. Audio
    await message.client.newsletterSendMessage(channelJid, {
      audio: Buffer.from(audioBuf),
      mimetype: "audio/mpeg",
      fileName: `${audioData.title}.mp3`,
    });

    await message.react("✅");

    return message.send(`✅ Sent to channel:\n${channelJid}`);

  } catch (err) {
    console.error(err);
    await message.react("❌");
    return message.send("Error: " + err.message);
  }
});
