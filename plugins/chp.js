import { Module } from "../lib/plugins.js";
import axios from "axios";
import fs from "fs";
import { exec } from "child_process";

// 🔊 Convert to WhatsApp voice (opus)
function toVoice(buffer) {
  return new Promise((resolve, reject) => {
    const input = "./temp_in.mp3";
    const output = "./temp_out.ogg";
    
    fs.writeFileSync(input, buffer);
    
    exec(`ffmpeg -i ${input} -vn -c:a libopus -b:a 64k ${output}`, (err) => {
      if (err) return reject(err);
      
      const data = fs.readFileSync(output);
      
      fs.unlinkSync(input);
      fs.unlinkSync(output);
      
      resolve(data);
    });
  });
}

Module({
  command: "cpost",
  aliases: ["cp"],
  fromMe: true,
  description: "Channel post with voice convert system",
})(async (message, match) => {
  try {
    if (!match) {
      return message.send("Usage: .cpost <channel_link> <text/url/reply>");
    }
    
    await message.react("⌛");
    
    const args = match.trim().split(" ");
    const link = args.shift();
    const input = args.join(" ");
    
    // 🔗 Extract invite ID
    const id = link.match(/channel\/([\w\d]+)/)?.[1];
    if (!id) return message.send("Invalid channel link");
    
    // 📡 Get channel JID
    const meta = await message.client.newsletterMetadata("invite", id);
    const jid = meta.id;
    
    let msg = null;
    
    // =========================
    // 🔥 REPLY MODE
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
      
      // IMAGE
      if (m.mimetype?.startsWith("image")) {
        msg = {
          image: buffer,
          caption: input || ""
        };
      }
      
      // AUDIO → 🔥 CONVERT TO VOICE
      else if (m.mimetype?.startsWith("audio")) {
        const voice = await toVoice(buffer);
        
        msg = {
          audio: voice,
          mimetype: "audio/ogg; codecs=opus",
          ptt: true
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
    // 🔥 URL MODE
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
        
        // AUDIO → 🔥 CONVERT TO VOICE
        else if (url.match(/\.(mp3|wav|m4a)/i)) {
          const voice = await toVoice(buffer);
          
          msg = {
            audio: voice,
            mimetype: "audio/ogg; codecs=opus",
            ptt: true
          };
        }
      }
    }
    
    // =========================
    // 📝 TEXT FALLBACK
    // =========================
    if (!msg) {
      msg = { text: input };
    }
    
    // =========================
    // 🚀 SEND TO CHANNEL
    // =========================
    await message.client.newsletterSendMessage(jid, msg);
    
    await message.react("✅");
    return message.send("✅ Channel post sent (voice supported)");
    
  } catch (err) {
    console.error("[CPOST ERROR]", err);
    await message.react("❌");
    return message.send("❌ Failed to send");
  }
});