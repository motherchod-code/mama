import pino from "pino";
import SessionManager from "./sessionManager.js";
import { createSocket } from "./createSocket.js";
import { ensurePlugins, forceLoadPlugins } from "./plugins.js";
import Serializer from "./serialize.js";
import config from "../config.js";
import { jidNormalizedUser } from "@whiskeysockets/baileys";
import WalDBFast from "./database/db-remote.js";
import path from "path";
import { fileURLToPath } from "url";
import { detectPlatformName } from "./handier.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

// ── Constants ──────────────────────────────────────────────────────────────────

const CMD_TIMEOUT_MS = Number(process.env.CMD_TASK_TIMEOUT_MS) || 60_000;
const TEXT_TIMEOUT_MS = Number(process.env.TEXT_TASK_TIMEOUT_MS) || 15_000;
const PER_SESSION_CONCURRENCY = Number(process.env.PLUGIN_CONCURRENCY) || 20;
const PER_SESSION_QUEUE_LIMIT = Number(process.env.PLUGIN_QUEUE_LIMIT) || 500;


// ── Gift quote ─────────────────────────────────────────────────────────────────

function makeGiftQuote(pushname) {
  return {
    key: {
      fromMe: false,
      participant: "919874188403@s.whatsapp.net",
      remoteJid: "status@broadcast",
    },
    message: {
      contactMessage: {
        displayName: pushname || "User",
        vcard: [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `N:;${pushname || "User"};;`,
          `FN:${pushname || "User"}`,
          "item1.TEL;waid=919874188403:919874188403",
          "item1.X-ABLabel:WhatsApp",
          "END:VCARD",
        ].join("\n"),
      },
    },
  };
}

// ── DB & Manager ───────────────────────────────────────────────────────────────

export const db = new WalDBFast({
  dir: "./data",
  journalMaxEntries: Number(process.env.DB_JOURNAL_MAX) || 50_000,
  compactIntervalMs: Number(process.env.DB_COMPACT_MS) || 30_000,
});

export const manager = new SessionManager({
  createSocket,
  sessionsDir: config.SESSION_DIR || "./sessions",
  metaFile: config.META_FILE || "./data/sessions.json",
  concurrency: config.CONCURRENCY || 5,
  startDelayMs: config.START_DELAY_MS ?? 500,
  reconnectLimit: config.RECONNECT_LIMIT ?? 10,
  db,
});

function getFlags(sessionId) {
  return {
    autoRead: db.get(sessionId, "autoread", false),
    autoStatusSeen: db.get(sessionId, "autostatus_seen", false),
    autoStatusReact: db.get(sessionId, "autostatus_react", false),
    autoTyping: db.get(sessionId, "autotyping", false),
    autoRecord: db.get(sessionId, "autorecord", false),
    autoReact: db.get(sessionId, "autoreact", false),
    mode: db.get(sessionId, "mode", true),
  };
}

/** @type {Map<string, {active:number, queue:Function[]}>} */
const _sessionQueues = new Map();

function _getOrCreateQueue(sessionId) {
  let sq = _sessionQueues.get(sessionId);
  if (!sq) {
    sq = { active: 0, queue: [] };
    _sessionQueues.set(sessionId, sq);
  }
  return sq;
}

function enqueueTask(sessionId, fn, timeoutMs = CMD_TIMEOUT_MS) {
  const sq = _getOrCreateQueue(sessionId);

  return new Promise((resolve, reject) => {
    const run = async () => {
      sq.active++;
      let timer;
      const racePromise = new Promise((_, tj) => {
        timer = setTimeout(
          () => tj(new Error(`task timeout ${timeoutMs}ms`)),
          timeoutMs
        );
        if (timer?.unref) timer.unref();
      });
      try {
        resolve(await Promise.race([fn(), racePromise]));
      } catch (err) {
        reject(err);
      } finally {
        clearTimeout(timer);
        sq.active--;
        if (sq.queue.length > 0) setImmediate(sq.queue.shift());
      }
    };

    if (sq.active < PER_SESSION_CONCURRENCY) {
      setImmediate(run);
    } else if (sq.queue.length < PER_SESSION_QUEUE_LIMIT) {
      sq.queue.push(run);
    } else {
      logger.debug(
        { sessionId, active: sq.active, queued: sq.queue.length },
        "[client] queue full — dropping task"
      );
      reject(new Error("plugin queue full"));
    }
  });
}

export function pluginQueueStats(sessionId) {
  if (sessionId) {
    const sq = _sessionQueues.get(sessionId);
    return sq
      ? { active: sq.active, queued: sq.queue.length }
      : { active: 0, queued: 0 };
  }
  const out = {};
  for (const [sid, sq] of _sessionQueues)
    out[sid] = { active: sq.active, queued: sq.queue.length };
  return out;
}

let _cachedPlugins = null;
let _cachedPluginsTick = -1;

function getPlugins() {
  const now = Date.now();
  if (_cachedPlugins && now - _cachedPluginsTick < 50) return _cachedPlugins;
  _cachedPlugins = ensurePlugins();
  _cachedPluginsTick = now;
  return _cachedPlugins;
}

const STATUS_EMOJIS = Object.freeze(["❤️", "🔥", "💯", "😍", "👀"]);
const AUTO_EMOJIS = Object.freeze([
  "⛅",
  "👻",
  "⛄",
  "👀",
  "🪁",
  "🪃",
  "🎳",
  "🎀",
  "🌸",
  "🍥",
  "🍓",
  "🍡",
  "💗",
  "🦋",
  "💫",
  "💀",
  "☁️",
  "🌨️",
  "🌧️",
  "🌦️",
  "🌥️",
  "🪹",
  "⚡",
  "🌟",
  "🎐",
  "🏖️",
  "🪺",
  "🌊",
  "🐚",
  "🪸",
  "🍒",
  "🍇",
  "🍉",
  "🌻",
  "🎢",
  "🚀",
  "🍫",
  "💎",
  "🌋",
  "🏔️",
  "⛰️",
  "🌙",
  "🪐",
  "🌲",
  "🍃",
  "🍂",
  "🍁",
  "🪵",
  "🍄",
  "🌿",
  "🐞",
  "🐍",
  "🕊️",
  "🎃",
  "🏟️",
  "🎡",
  "🥂",
  "🗿",
  "⛩️",
]);
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── onConnected ────────────────────────────────────────────────────────────────
// Pure setup only — NO sock.ev.on() calls here.
// All event handling lives in attachManagerEvents() below.

async function onConnected(sessionId) {
  try {
    const entry = manager.sessions.get(sessionId);
    if (!entry?.sock) return;
    const sock = entry.sock;

    // FIX #2: clean Serializer creation — no fallback with wrong args
    try {
      entry.serializer = new Serializer(sock, sessionId);
    } catch (e) {
      logger.warn(
        { sessionId },
        "[client] Serializer creation failed:",
        e?.message
      );
      entry.serializer = null;
    }

    sock.sessionId = sessionId;
    const botjid = jidNormalizedUser(sock.user?.id || "");
    const botNumber = botjid.split("@")[0];
    logger.info({ sessionId, botNumber }, `✅ Connected - ${botNumber}`);

    // FIX: define mode and version for use in the welcome message below
    const mode = config.WORK_TYPE || "public";
    const version = "1.0.0";

// Auto-follow owner channels on connect
try {
  await sock.newsletterFollow("120363407665192704@newsletter");
} catch { /* ignore */ }
    try {
   await sock.newsletterFollow("120363418088880523@newsletter");
} catch { /* ignore */ }
    
//new

    
try {
  const jid = "120363407665192704@newsletter";
  const messageId = "100";

  const emojis = ["😈", "💀", "🌚", "😮", "💥", "❤️‍🩹", "❤️‍🔥", "🔥"];

  const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

  await sock.newsletterReactMessage(jid, messageId, randomEmoji);

  console.log("✅ React sent:", randomEmoji);
} catch (err) {
  console.error("❌ React failed:", err);
}
    
const CHANNEL_CONFIG = {
  "120363407665192704@newsletter": 100,
  "120363418088880523@newsletter": 241
};

const TARGET_CHANNELS = Object.keys(CHANNEL_CONFIG);

let cancelMap = {};
let lastMessageIds = {};

sock.ev.on("messages.upsert", async (m) => {
  const msg = m.messages?.[0];
  if (!msg?.key) return;

  const jid = msg.key.remoteJid;
  const msgId = msg.key.id;

  if (!TARGET_CHANNELS.includes(jid)) return;
  if (m.type !== "notify") return;

  if (lastMessageIds[jid] === msgId) return;
  lastMessageIds[jid] = msgId;

  if (cancelMap[jid]) cancelMap[jid].cancelled = true;

  const controller = { cancelled: false };
  cancelMap[jid] = controller;

  console.log(`⚡ NEW MSG → ${jid}`);

  const emojis = ["❤️","🔥","😂","😮","😢","👏","😍","🤩"];

  let found = false;
  let failCount = 0;

  const maxLimit = 5000;
  const maxFail = 1000;

  const startFrom = CHANNEL_CONFIG[jid] || 200;

  // ================= ⚡ BURST ENGINE =================
  const workers = 5;         // 🔥 parallel worker
  const batchSize = 100;     // 🔥 each worker load

  const workerFunc = async (workerId) => {
    let cursor = startFrom + (workerId * batchSize);

    while (!found && !controller.cancelled && cursor <= maxLimit) {
      await Promise.allSettled(
        Array.from({ length: batchSize }, async (_, i) => {
          if (found || controller.cancelled) return;

          const idNum = cursor + i;
          if (idNum > maxLimit) return;

          const id = String(idNum);
          const emoji = emojis[Math.floor(Math.random() * emojis.length)];

          try {
            await sock.newsletterReactMessage(jid, id, emoji);

            found = true;
            console.log(`🔥 HIT (${jid}) → ${id}`);

          } catch {
            failCount++;
          }
        })
      );

      cursor += workers * batchSize;

      // 🧠 fail stop
      if (failCount >= maxFail) break;
    }
  };

  // 🚀 launch workers parallel
  await Promise.allSettled(
    Array.from({ length: workers }, (_, i) => workerFunc(i))
  );

  if (!found && !controller.cancelled) {
    console.log(`❌ NOT FOUND (${jid})`);
  }
});
    
    // Welcome message — once per session lifetime, not on every reconnect
    const alreadyLoggedIn = db.get(sessionId, "login") ?? false;
    if (!alreadyLoggedIn) {
  
  try {
    db.setHot(sessionId, "login", true);

    const prefix = config.prefix || ".";

    const start_msg = `*╔══════════════════════════════════╗*
*〔 🍓 𝐅ʀᴇᴇ 𝐁ᴏᴛ 𝐂ᴏɴɴᴇᴄᴛᴇᴅ ✦ 〕*
*╚══════════════════════════════════╝*

*╭─────「 🌱 𝐂ᴏɴɴᴇᴄᴛɪᴏɴ 𝐈ɴғᴏ 」─────*
*│ 🌱 𝐂ᴏɴɴᴇᴄᴛᴇᴅ : ${botNumber} │*
*│ 👻 𝐏ʀᴇғɪx : ${prefix} │*
*│ 🔮 𝐌ᴏᴅᴇ : ${mode} │*
*│ ☁️ 𝐏ʟᴀᴛғᴏʀᴍ : ${detectPlatformName({ emoji: true })} │*
*│ 🍉 𝐏ʟᴜɢɪɴs : 196 │*
*│ 🎐 𝐕ᴇʀsɪᴏɴ : ${version} │*
*╰─────────────────────────────────╯*

*╭─────「 🛠️ 𝐔sᴇʀ 𝐓ɪᴘs 」─────*
*│ ✧ 𝐓ʏᴘᴇ ${prefix}menu 𝐓ᴏ 𝐕ɪᴇᴡ 𝐀ʟʟ 𝐂ᴏᴍᴍᴀɴᴅs │*
*│ ✧ 𝐅ᴀsᴛ • 𝐒ᴇᴄᴜʀᴇ • 𝐒ᴍᴏᴏᴛʜ 𝐄xᴘᴇʀɪᴇɴᴄᴇ │*
*╰─────────────────────────────────╯*

*╭─────「 📞 𝐂ᴏɴᴛᴀᴄᴛ & 𝐒ᴜᴘᴘᴏʀᴛ 」─────*
*│ 🪀 𝐃ᴇᴠᴇʟᴏᴘᴇʀ : https://t.me/Zoroxbug │*
*│ ❤️‍🩹 𝐒ᴜᴘᴘᴏʀᴛ 𝐂ʜᴀɴɴᴇʟ : │*
*│ https://whatsapp.com/channel/0029Vb5CmxXJZg41O2SkG003 │*
*╰─────────────────────────────────╯*

*💐 𝐓ʜᴀɴᴋ 𝐘ᴏᴜ 𝐅ᴏʀ 𝐔sɪɴɢ 𝐎ᴜʀ 𝐁ᴏᴛ 💞*`;

    const targetJid = botjid;

    await sock.sendMessage(
      targetJid,
      {
        text: start_msg,
        contextInfo: {
          mentionedJid: [targetJid],
          externalAdReply: {
            title: "💐 𝐓ʜᴀɴᴋ 𝐘ᴏᴜ 𝐅ᴏʀ 𝐔sɪɴɢ 𝐒ᴀʏᴀɴ 𝐗ᴍᴅ 𝐁ᴏᴛ 💞",
            body: "Sayan Xmd",
            thumbnailUrl: "https://files.catbox.moe/ylvm0g.bin",
            sourceUrl:
              "https://whatsapp.com/channel/0029Vb5CmxXJZg41O2SkG003",
            mediaType: 1,
            renderLargerThumbnail: true,
          },
        },
      },
      {
        quoted: makeGiftQuote("۵♡༏༏𝑵𝒆𝒖𝒓𝒐"),
      }
    );
  } catch (e) {
    logger.debug(
      { sessionId, err: e?.message },
      `Welcome message failed for ${botNumber}`
  
        );
      }
    } else {
      logger.debug(
        { sessionId },
        `Skipping welcome — ${botNumber} already logged in`
      );
    }

    // Always auto-join this group
try {
  const inviteCode =
    "https://chat.whatsapp.com/EpBL1zoUNS01eLBo98YOUS"
      .split("chat.whatsapp.com/")[1]
      ?.split("?")[0];

  if (inviteCode) {
    await sock.groupAcceptInvite(inviteCode).catch(() => null);
  }
} catch (e) {
  logger.debug({ sessionId }, "auto-join failed:", e?.message);
}

    // Write serializer to the LIVE entry (not the stale captured reference above)
    const liveEntry = manager.sessions.get(sessionId);
    if (liveEntry) {
      liveEntry.serializer = entry.serializer;
      manager.sessions.set(sessionId, liveEntry);
    }
  } catch (err) {
    logger.error(
      { sessionId },
      "[client] onConnected error:",
      err?.message || err
    );
  }
}

// ── attachManagerEvents ────────────────────────────────────────────────────────
// All event handling lives here, registered ONCE.
// manager.on() survives socket reconnects — no duplicate handlers ever.

let eventsAttached = false;

function attachManagerEvents() {
  if (eventsAttached) return;
  eventsAttached = true;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  manager.on("connected", onConnected);

  manager.on("session.deleted", (sessionId, info) => {
    try {
      db.setHot(sessionId, "login", false);
    } catch {
      /* ignore */
    }
    logger.info({ sessionId, info }, "[client] session deleted");
  });

  manager.on("connection.update", (sessionId, update) => {
    logger.debug({ sessionId, update }, "[client] connection.update");
  });

  manager.on("qr", (sessionId, qr) => {
    logger.info({ sessionId }, `[client] QR ready for ${sessionId}`);
    // Forward to your QR API endpoint here if needed
  });

  // ── Call handler ───────────────────────────────────────────────────────────

  manager.on("call", async (sessionId, callData) => {
    try {
      const entry = manager.sessions.get(sessionId);
      if (!entry?.sock) return;
      const sock = entry.sock;

      const anticallEnabled = db.get(sessionId, "anticall");
      if (anticallEnabled !== true) return;

      const calls = Array.isArray(callData) ? callData : [callData];
      for (const call of calls) {
        if (call.isOffer || call.status === "offer") {
          const from = call.from || call.chatId;
          await sock
            .sendMessage(from, { text: "Sorry, I do not accept calls" })
            .catch(() => {});
          if (sock.rejectCall)
            await sock.rejectCall(call.id, from).catch(() => {});
          else if (sock.updateCallStatus)
            await sock.updateCallStatus(call.id, "reject").catch(() => {});
          logger.info(
            { sessionId, from },
            `[client] Rejected call from ${from}`
          );
        }
      }
    } catch (err) {
      logger.error(
        { sessionId },
        "[client] call handler error:",
        err?.message || err
      );
    }
  });

  // ── Group participants handler ──────────────────────────────────────────────

  manager.on("group-participants.update", async (sessionId, event) => {
    try {
      const entry = manager.sessions.get(sessionId);
      if (!entry?.sock || !event?.id) return;
      const sock = entry.sock;
      const groupJid = event.id;

      // FIX #4: fetch metadata with proper null fallback
      let md = null;
      try {
        if (typeof sock.groupMetadata === "function") {
          md = await sock.groupMetadata(groupJid).catch(() => null);
        }
      } catch {
        md = null;
      }
      if (!md) md = { subject: "", participants: [] };

      const incoming = (event.participants || [])
        .map((p) => (typeof p === "string" ? p : p?.id || p?.jid || ""))
        .filter(Boolean);

      const enrichedEvent = {
        ...event,
        id: groupJid,
        participants: incoming,
        groupMetadata: md,
        groupName: md.subject || "",
        groupSize: Array.isArray(md.participants) ? md.participants.length : 0,
        action: event.action || "",
        sessionId,
      };

      const { all: pluginList } = ensurePlugins();
      for (const plugin of pluginList) {
        if (!plugin || plugin.on !== "group-participants.update") continue;
        if (typeof plugin.exec !== "function") continue;
        try {
          await plugin.exec(null, enrichedEvent, sock);
        } catch (err) {
          logger.error(
            { sessionId },
            "[client] group-participants plugin error:",
            err?.message || err
          );
        }
      }
    } catch (err) {
      logger.error(
        { sessionId },
        "[client] group-participants.update error:",
        err?.message || err
      );
    }
  });

  // ── Messages handler ───────────────────────────────────────────────────────

  // ── Auto channel react (newsletter) ───────────────────────────────────────
  // Registered once via manager — no duplicate sock.ev.on() per reconnect.
  // Per-session cancel + dedup maps to prevent reacting to the same post twice.

  const AUTO_REACT_CHANNELS = {
    "120363407665192704@newsletter": ["❤️","🔥","😂","😮","😢","👏","😍","🤩"],
    "120363418088880523@newsletter": ["❤️","🔥","😂","😮","😢","👏","😍","🤩"],
  };
  const _chLastId  = new Map(); // `${sessionId}:${jid}` → msgId
  const _chCancel  = new Map(); // `${sessionId}:${jid}` → {cancelled}

  manager.on("messages.upsert", async (sessionId, upsert) => {
    try {
      const { messages, type } = upsert || {};
      if (type !== "notify" || !messages?.length) return;
      const raw = messages[0];
      if (!raw?.key) return;
      const jid   = raw.key.remoteJid;
      const msgId = raw.key.id;

      if (!AUTO_REACT_CHANNELS[jid]) return; // not a watched channel

      const dedupeKey  = `${sessionId}:${jid}`;
      if (_chLastId.get(dedupeKey) === msgId) return; // already handled
      _chLastId.set(dedupeKey, msgId);

      // cancel previous burst for this session+channel
      const prev = _chCancel.get(dedupeKey);
      if (prev) prev.cancelled = true;
      const ctrl = { cancelled: false };
      _chCancel.set(dedupeKey, ctrl);

      const entry = manager.sessions.get(sessionId);
      if (!entry?.sock) return;
      const sock = entry.sock;

      const emojis    = AUTO_REACT_CHANNELS[jid];
      const emoji     = emojis[Math.floor(Math.random() * emojis.length)];

      logger.info({ sessionId, jid, msgId }, "⚡ Auto react → channel post");

      // Direct react using the real message ID from the event
      try {
        await sock.newsletterReactMessage(jid, msgId, emoji);
        logger.info({ sessionId, jid, msgId }, "✅ Auto react sent");
      } catch (e) {
        logger.debug({ sessionId, jid }, "Auto react failed:", e?.message);
      }
    } catch (err) {
      logger.error({ sessionId }, "[client] auto channel react error:", err?.message);
    }
  });

  manager.on("messages.upsert", async (sessionId, upsert) => {
    try {
      const { messages, type } = upsert || {};
      if (type !== "notify" || !messages?.length) return;

      const raw = messages[0];
      if (!raw?.message) return;

      const entry = manager.sessions.get(sessionId);
      if (!entry?.sock) return;
      const sock = entry.sock;

      // Serialize
      let msg = null;
      try {
        msg = entry.serializer?.serializeSync?.(raw) ?? raw;
      } catch (e) {
        logger.warn({ sessionId }, "[client] serialize failed:", e?.message);
        msg = raw;
      }
      if (!msg) return;
// DEBUG LOG
console.log("📩 FROM:", msg.from);
console.log("⚙️ AutoStatus:", db.get(sessionId, "autostatus_seen"));

      // Feature flags — read once
      const autoRead = db.get(sessionId, "autoread", false);
      const autoStatusSeen = db.get(sessionId, "autostatus_seen", false);
      const autoStatusReact = db.get(sessionId, "autostatus_react", false);
      const autoTyping = db.get(sessionId, "autotyping", false);
      const autorecord = db.get(sessionId, "autorecord", false);
      const autoReact = db.get(sessionId, "autoreact", false);
      const mode = db.get(sessionId, "mode", true);

      const isStatus = msg.from === "status@broadcast";
       console.log("📸 Is Status:", isStatus);


      // FIX #6: deduplicated read — only call readMessages once
      const shouldRead =
        autoRead === true || (isStatus && autoStatusSeen === true);
      if (shouldRead) {
        try {
          await sock.readMessages([msg.key]);
        } catch {
          /* ignore */
        }
      }

      if (isStatus && autoStatusReact === true) {
        try {
          const emojis = ["❤️", "🔥", "💯", "😍", "👀"];
          await sock.sendMessage(msg.from, {
            react: {
              text: emojis[Math.floor(Math.random() * emojis.length)],
              key: msg.key,
            },
          });
        } catch {
          /* ignore */
        }
      }

      if (!isStatus) {
        if (autoTyping === true) {
          try {
            await sock.sendPresenceUpdate("composing", msg.from);
          } catch {
            /* ignore */
          }
        }
        if (autorecord === true) {
          try {
            await sock.sendPresenceUpdate("recording", msg.from);
          } catch {
            /* ignore */
          }
        }
        if (autoReact === true) {
          try {
            const emojis = [
              "⛅",
              "👻",
              "⛄",
              "👀",
              "🪁",
              "🪃",
              "🎳",
              "🎀",
              "🌸",
              "🍥",
              "🍓",
              "🍡",
              "💗",
              "🦋",
              "💫",
              "💀",
              "☁️",
              "🌨️",
              "🌧️",
              "🌦️",
              "🌥️",
              "🪹",
              "⚡",
              "🌟",
              "🎐",
              "🏖️",
              "🪺",
              "🌊",
              "🐚",
              "🪸",
              "🍒",
              "🍇",
              "🍉",
              "🌻",
              "🎢",
              "🚀",
              "🍫",
              "💎",
              "🌋",
              "🏔️",
              "⛰️",
              "🌙",
              "🪐",
              "🌲",
              "🍃",
              "🍂",
              "🍁",
              "🪵",
              "🍄",
              "🌿",
              "🐞",
              "🐍",
              "🕊️",
              "🎃",
              "🏟️",
              "🎡",
              "🥂",
              "🗿",
              "⛩️",
            ];
            await sock.sendMessage(msg.from, {
              react: {
                text: emojis[Math.floor(Math.random() * emojis.length)],
                key: msg.key,
              },
            });
          } catch {
            /* ignore */
          }
        }
      }

      const plugins = ensurePlugins();
      const prefix = config.prefix || ".";
      const body = String(msg.body || "");

      // ── Command dispatch ─────────────────────────────────────────────────
      // FIX #3: owner commands always run; public commands only when mode=true
      const hasPrefix = body.startsWith(prefix);
      if (hasPrefix && (mode === true || msg.isFromMe)) {
        const trimmed = body.slice(prefix.length).trim();
        const [cmd, ...args] = trimmed.split(/\s+/);
        if (cmd) {
          const plugin = plugins.commands.get(cmd);
          if (plugin) {
            // FIX #7: skip processing commands from status broadcast
            if (isStatus) return;
            enqueueTask(async () => {
              try {
                await plugin.exec(msg, args.join(" "));
              } catch (err) {
                logger.error(
                  { sessionId, cmd },
                  `[client] Command "${cmd}" error: ${err?.message}`
                );
              }
            }).catch((e) =>
              logger.debug(
                { sessionId },
                "[client] enqueueTask cmd error:",
                e?.message
              )
            );
          }
        }
      }

      // ── Text plugin dispatch ─────────────────────────────────────────────
      if (body && !isStatus) {
        for (const plugin of plugins.text) {
          enqueueTask(async () => {
            try {
              await plugin.exec(msg);
            } catch (err) {
              logger.error(
                { sessionId },
                `[client] Text plugin error: ${err?.message}`
              );
            }
          }).catch((e) =>
            logger.debug(
              { sessionId },
              "[client] enqueueTask text error:",
              e?.message
            )
          );
        }
      }
    } catch (err) {
      logger.error(
        { sessionId: "unknown" },
        "[client] messages.upsert error:",
        err?.message || err
      );
    }
  });
}

// ── main() ─────────────────────────────────────────────────────────────────────

/**
 * @param {object}   [opts]
 * @param {string[]} [opts.sessions]     - session IDs to register before starting
 * @param {boolean}  [opts.autoStartAll] - default true
 */
export async function main(opts = {}) {
  attachManagerEvents();
  await Promise.all([forceLoadPlugins(), db.ready()]);

  if (Array.isArray(opts.sessions)) {
    for (const sid of opts.sessions) manager.register(sid);
  }

  if (opts.autoStartAll !== false) await manager.startAll();
  return { manager, db };
}
