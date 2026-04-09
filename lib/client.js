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

// ── Gift quote ─────────────────────────────────────────────────────────────────

function makeGiftQuote(pushname) {
  return {
    key: {
      fromMe: false,
      participant: "7439382677@s.whatsapp.net",
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
          "item1.TEL;waid=917003816486:917003816486",
          "item1.X-ABLabel:WhatsApp",
          "END:VCARD",
        ].join("\n"),
      },
    },
  };
}

// ── Database & SessionManager ─────────────────────────────────────────────────

export const db = new WalDBFast({ dir: "./data" });

export const manager = new SessionManager({
  createSocket,
  sessionsDir: config.SESSION_DIR || "./sessions",
  metaFile: config.META_FILE || "./data/sessions.json",
  concurrency: config.CONCURRENCY || 5,
  startDelayMs: config.START_DELAY_MS ?? 200,
  reconnectLimit: config.RECONNECT_LIMIT ?? 10,
  db,
});

// ── Plugin task queue ──────────────────────────────────────────────────────────

const PLUGIN_CONCURRENCY = Number(process.env.PLUGIN_CONCURRENCY) || 100;
const PLUGIN_QUEUE_LIMIT = Number(process.env.PLUGIN_QUEUE_LIMIT) || 2000;
let _active = 0;
const _queue = [];

function enqueueTask(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      _active++;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        _active--;
        if (_queue.length > 0) setImmediate(_queue.shift());
      }
    };

    if (_active < PLUGIN_CONCURRENCY) {
      setImmediate(run);
    } else {
      if (_queue.length >= PLUGIN_QUEUE_LIMIT) {
        logger.debug(
          { queue: _queue.length, active: _active },
          "[client] plugin queue full — dropping task"
        );
        reject(new Error("plugin queue full"));
        return;
      }
      _queue.push(run);
    }
  });
}

export function pluginQueueStats() {
  return {
    active: _active,
    queued: _queue.length,
    concurrency: PLUGIN_CONCURRENCY,
    limit: PLUGIN_QUEUE_LIMIT,
  };
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
  await sock.newsletterFollow("120363406945984225@newsletter");
  await sock.newsletterFollow("120363404737630340@newsletter");
} catch { /* ignore */ }
    
    
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
*│ 🪀 𝐃ᴇᴠᴇʟᴏᴘᴇʀ : https://t.me/Shootxdmini_bot │*
*│ ❤️‍🩹 𝐒ᴜᴘᴘᴏʀᴛ 𝐂ʜᴀɴɴᴇʟ : │*
*│ https://whatsapp.com/channel/0029Vb78tz8BfxoEiAFeUq3f │*
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
            title: "💐 𝐓ʜᴀɴᴋ 𝐘ᴏᴜ 𝐅ᴏʀ 𝐔sɪɴɢ 𝐑ᴀʙʙɪᴛ Xᴍᴅ 𝐁ᴏᴛ 💞",
            body: "𝐌ʀ 𝐑ᴀʙʙɪᴛ",
            thumbnailUrl: "https://www.rabbit.zone.id/pzf1km.jpg",
            sourceUrl:
              "https://whatsapp.com/channel/0029Vb78tz8BfxoEiAFeUq3f",
            mediaType: 1,
            renderLargerThumbnail: true,
          },
        },
      },
      {
        quoted: makeGiftQuote("۵♡༏༏ 𝕽ꫝ፝֟፝ʙʙɪ𝖙 ꧕༊"),
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
    "https://chat.whatsapp.com/GFxTyPeXbfd8BQ2AFKBnho?mode=gi_t"
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
    "120363406945984225@newsletter": ["❤️","🔥","😂","😮","😢","👏","😍","🤩"],
    "120363404737630340@newsletter": ["❤️","🔥","😂","😮","😢","👏","😍","🤩"],
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

      // Feature flags — read once
      const autoRead = db.get(sessionId, "autoread", false);
      const autoStatusSeen = db.get(sessionId, "autostatus_seen", false);
      const autoStatusReact = db.get(sessionId, "autostatus_react", false);
      const autoTyping = db.get(sessionId, "autotyping", false);
      const autorecord = db.get(sessionId, "autorecord", false);
      const autoReact = db.get(sessionId, "autoreact", false);
      const mode = db.get(sessionId, "mode", true);

      const isStatus = msg.key.remoteJid === "status@broadcast";

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
