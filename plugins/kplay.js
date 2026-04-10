// plugins/play.js
import axios from "axios";
import yts from "yt-search";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import os from "os";
import { Module } from "../lib/plugins.js";

Module({
  command: "kplay",
  description: "Play song as voice note",
})(async (message, match, m, client) => {
  try {
    if (!match) {
      return message.send("❌ Enter song name\n\n.play faded");
    }

    await message.react("🔍");

    // 🔎 YouTube search
    const res = await yts(match);
    if (!res.videos || res.videos.length === 0) {
      return message.send("❌ Song not found");
    }

    const video = res.videos[0];

    // 🎵 Info message (clean UI)
    const caption = `
🎵 *Now Playing*

📌 *Title:* ${video.title}
👤 *Channel:* ${video.author.name}
⏱️ *Duration:* ${video.timestamp}

🎧 *Preparing your audio...*
`.trim();

    await message.send({
      image: { url: video.thumbnail },
      caption,
      mimetype: "image/jpeg",
    });

    // 🌐 API call
    const apiUrl =
      "https://api-aswin-sparky.koyeb.app/api/downloader/song?search=" +
      encodeURIComponent(video.url);

    const { data } = await axios.get(apiUrl, { timeout: 30000 });

    if (!data || !data.status || !data.data?.url) {
      return message.send("❌ Audio download failed");
    }

    // 📥 Download audio buffer
    const audioRes = await axios.get(data.data.url, {
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(audioRes.data);

    // 📁 temp file
    const tmp = (ext) =>
      path.join(os.tmpdir(), `play-${Date.now()}.${ext}`);

    const input = tmp("mp3");
    const output = tmp("ogg");

    fs.writeFileSync(input, buffer);

    // 🎙️ Convert to OGG
    await new Promise((resolve, reject) => {
      ffmpeg(input)
        .audioCodec("libopus")
        .audioBitrate("48k")
        .noVideo()
        .format("ogg")
        .on("error", reject)
        .on("end", resolve)
        .save(output);
    });

    const voice = fs.readFileSync(output);

    // 🧹 cleanup
    fs.unlinkSync(input);
    fs.unlinkSync(output);

    // 📦 Data for externalAdReply
    const datas = {
      title: video.title,
      thumbnail: video.thumbnail,
    };

    // 🎙️ Send using Aliconn style
    await client.sendMessage(
      message.from,
      {
        audio: voice,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
        contextInfo: {
          externalAdReply: {
            title: `${datas.title}`,
            body: "Gᴇɴᴇʀᴀᴛᴇᴅ ʙʏ 〆͎ＭＲ－Ｒａｂｂｉｔ",
            mediaType: 1,
            sourceUrl: video.url,
            thumbnailUrl: datas.thumbnail,
          },
        },
      },
      { quoted: message.raw }
    );

    await message.react("🎧");

  } catch (err) {
    console.error("[PLAY ERROR]", err);
    await message.send("⚠️ Play failed");
  }
});
