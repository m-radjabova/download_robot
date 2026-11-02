require("dotenv").config();

const crypto = require("crypto");
const { Telegraf } = require("telegraf");
const {
  detectPlatform,
  downloadVideoFile,
  extractUrl,
  validateVideoUrl,
} = require("./config/api");
const { initializeDatabase } = require("./config/db");
const users = require("./modules/user.module");

const token = process.env.TOKEN;
if (!token) throw new Error("TOKEN .env faylida berilmagan.");

const bot = new Telegraf(token, { handlerTimeout: 10 * 60 * 1000 });
const tg = bot.telegram;

const BOT_USERNAME = process.env.BOT_USERNAME?.replace(/^@/, ""); // ixtiyoriy
const DEFAULT_PHONE = "Kiritilmagan";
const JOB_TTL_MS = 30 * 60 * 1000;

const BTN = {
  download: "📥 Video yuklash",
  profile: "👤 Profil",
  help: "❓ Yordam",
  cancel: "❌ Bekor qilish",
};

const PLATFORMS = {
  instagram: { icon: "📸", name: "Instagram", example: "https://www.instagram.com/reel/..." },
  youtube: { icon: "▶️", name: "YouTube", example: "https://www.youtube.com/watch?v=..." },
  facebook: { icon: "📘", name: "Facebook", example: "https://www.facebook.com/watch?v=..." },
  tiktok: { icon: "🎵", name: "TikTok", example: "https://www.tiktok.com/@user/video/..." },
};

const HAS_QUALITY = ["youtube", "tiktok"]; 

const DOWNLOAD_FORMATS = [
  { id: "360p", label: "📱 360p" },
  { id: "480p", label: "📺 480p" },
  { id: "720p", label: "🖥 720p HD" },
  { id: "1080p", label: "🎞 1080p Full HD" },
  { id: "mp3", label: "🎵 MP3 (audio)" },
];

const STAGES = [
  "☁️ Video tayyorlanmoqda",
  "📥 Fayl yuklab olinmoqda",
  "📤 Telegramga yuborilmoqda",
];

const userStates = new Map(); // userId -> { step: "editName" | "editPhone" }
const pendingJobs = new Map(); // token -> { userId, platform, sourceUrl, format, createdAt }
const activeDownloads = new Set(); // bir vaqtda faqat bitta yuklash

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of pendingJobs) {
    if (now - job.createdAt > JOB_TTL_MS) pendingJobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/*  Yordamchi funksiyalar                                              */
/* ------------------------------------------------------------------ */

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const inline = (rows) => ({ inline_keyboard: rows });

function mainKeyboard() {
  return {
    keyboard: [[{ text: BTN.download }], [{ text: BTN.profile }, { text: BTN.help }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Video havolasini shu yerga tashlang 🔗",
  };
}

const send = (chatId, text, markup) =>
  tg.sendMessage(chatId, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(markup ? { reply_markup: markup } : {}),
  });

async function edit(chatId, messageId, text, rows = []) {
  try {
    await tg.editMessageText(chatId, messageId, undefined, text, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: inline(rows),
    });
    return true;
  } catch (error) {
    if (/message is not modified/i.test(error.message)) return true;
    console.error(`Xabarni tahrirlab bo'lmadi (${messageId}):`, error.message);
    return false;
  }
}

/** Xabarni tahrirlaydi, bo'lmasa yangisini yuboradi. Xabar ID sini qaytaradi. */
async function show(chatId, messageId, text, rows = []) {
  if (messageId && (await edit(chatId, messageId, text, rows))) return messageId;
  const message = await send(chatId, text, inline(rows));
  return message.message_id;
}

const removeMessage = (chatId, messageId) => tg.deleteMessage(chatId, messageId).catch(() => {});

function createJob(userId, data) {
  const id = crypto.randomBytes(4).toString("hex");
  pendingJobs.set(id, { ...data, userId, createdAt: Date.now() });
  return id;
}

async function ensureUser(from) {
  let user = await users.getUser(from.id);
  if (!user) {
    const name = (from.first_name || from.username || "Foydalanuvchi").slice(0, 50);
    await users.saveUser(from.id, name, DEFAULT_PHONE);
    user = (await users.getUser(from.id)) || { username: name, phonenumber: DEFAULT_PHONE };
  }
  return user;
}

const validPhone = (phone) => typeof phone === "string" && /^\+?[\d\s()-]{7,20}$/.test(phone);

/* ------------------------------------------------------------------ */
/*  Ekranlar                                                           */
/* ------------------------------------------------------------------ */

function platformRows() {
  return [
    [
      { text: "📸 Instagram", callback_data: "pf:instagram" },
      { text: "▶️ YouTube", callback_data: "pf:youtube" },
    ],
    [
      { text: "📘 Facebook", callback_data: "pf:facebook" },
      { text: "🎵 TikTok", callback_data: "pf:tiktok" },
    ],
  ];
}

const showWelcome = (chatId, user) =>
  send(
    chatId,
    `👋 Assalomu alaykum, <b>${esc(user.username)}</b>!\n\n` +
      `Men <b>Instagram</b>, <b>YouTube</b>, <b>Facebook</b> va <b>TikTok</b>dan video yuklab beraman.\n\n` +
      `🔗 <b>Video havolasini shu yerga yuboring</b>\n\n` +
      `📸 Instagram  ·  ▶️ YouTube  ·  📘 Facebook  ·  🎵 TikTok`,
    mainKeyboard(),
  );

const showHelp = (chatId) =>
  send(
    chatId,
    `❓ <b>Qanday ishlatiladi?</b>\n\n` +
      `1️⃣ Videodan <b>havolani nusxalang</b> 📋\n` +
      `2️⃣ Uni <b>shu yerga yuboring</b> 🔗\n` +
      `3️⃣ YouTube va TikTok'da <b>sifat yoki MP3 formatini tanlang</b> 🎞\n` +
      `4️⃣ Videoni oling 🎉\n\n` +
      `📏 Telegram limiti — <b>50 MB</b>. Katta video bo'lsa, past sifat yoki MP3 tanlang.\n` +
      `🔒 Faqat ochiq (public) videolar yuklanadi.`,
    mainKeyboard(),
  );

const showPlatformPicker = (chatId, messageId) =>
  show(
    chatId,
    messageId,
    `📥 <b>Qaysi platformadan yuklaymiz?</b>\n\nTanlang yoki havolani to'g'ridan-to'g'ri yuboring 👇`,
    platformRows(),
  );

const showProfile = (chatId, user, messageId) =>
  show(
    chatId,
    messageId,
    `👤 <b>Profilingiz</b>\n\n📝 Ism: <b>${esc(user.username)}</b>\n📱 Telefon: <b>${esc(user.phonenumber)}</b>`,
    [
      [
        { text: "✏️ Ismni o'zgartirish", callback_data: "profile:edit_name" },
        { text: "📱 Telefon", callback_data: "profile:edit_phone" },
      ],
      [{ text: "🗑 Hisobni o'chirish", callback_data: "profile:delete" }],
    ],
  );

function qualityRows(jobToken, onlyIds) {
  const buttons = DOWNLOAD_FORMATS.filter((f) => !onlyIds || onlyIds.includes(f.id)).map((f) => ({
    text: f.label,
    callback_data: `dl:${jobToken}:${f.id}`,
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

function progressText(step, extra = "") {
  const bar = "🟩".repeat(step) + "⬜".repeat(STAGES.length - step);
  return `${bar}\n\n${STAGES[step - 1]}...${extra}\n\n<i>Iltimos, biroz kuting ⏳</i>`;
}

/* ------------------------------------------------------------------ */
/*  Video yuklash                                                      */
/* ------------------------------------------------------------------ */

async function handleLink(chatId, from, rawUrl) {
  let platform;
  let sourceUrl;
  try {
    platform = detectPlatform(rawUrl);
    sourceUrl = validateVideoUrl(rawUrl, platform);
  } catch (error) {
    await send(
      chatId,
      `⚠️ ${esc(error.userMessage || error.message)}\n\nPlatformani tanlang yoki to'g'ri havola yuboring 👇`,
      inline(platformRows()),
    );
    return;
  }

  const jobToken = createJob(from.id, {
    platform,
    sourceUrl,
    format: HAS_QUALITY.includes(platform) ? "720p" : undefined,
  });

  if (HAS_QUALITY.includes(platform)) {
    await send(
      chatId,
      `${PLATFORMS[platform].icon} <b>${PLATFORMS[platform].name}</b> videosi topildi! ✅\n\n🎞 <b>Sifat yoki formatni tanlang:</b>\n\n` +
        `💡 <i>Telegram 50 MB gacha fayl qabul qiladi. Uzun video bo'lsa — past sifat yoki MP3 tanlang.</i>`,
      inline([...qualityRows(jobToken), [{ text: BTN.cancel, callback_data: `cancel:${jobToken}` }]]),
    );
    return;
  }

  await runDownload(chatId, from, jobToken);
}

async function runDownload(chatId, from, jobToken, { format, messageId } = {}) {
  const job = pendingJobs.get(jobToken);
  if (!job || job.userId !== from.id) {
    await send(chatId, "⌛ Bu so'rov eskirgan. Havolani qaytadan yuboring 🔗");
    return;
  }
  if (activeDownloads.has(from.id)) {
    await send(chatId, "⏳ Oldingi videongiz hali tayyorlanmoqda. Tugashini kuting 🙏");
    return;
  }
  if (format) job.format = format;

  activeDownloads.add(from.id);
  const isAudio = job.format === "mp3";
  const actionTimer = setInterval(() => {
    tg.sendChatAction(chatId, isAudio ? "upload_voice" : "upload_video").catch(() => {});
  }, 4_000);

  let progressId = messageId;
  let downloadId;
  const setStep = async (step, extra = "") => {
    progressId = await show(chatId, progressId, progressText(step, extra));
  };
  const saveStatus = async (status, details) => {
    if (!downloadId) return;
    try {
      await users.setDownloadStatus(from.id, downloadId, status, details);
    } catch (error) {
      console.error("Yuklab olish holatini saqlab bo'lmadi:", error.message);
    }
  };

  try {
    await ensureUser(from);
    downloadId = await users.createDownload(from.id, job.sourceUrl, job.platform, from.username);

    await setStep(1);
    await setStep(2);
    const { buffer } = await downloadVideoFile(job.sourceUrl, job.platform, { format: job.format });
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(1);

    await setStep(3, `\n📦 Hajmi: ${sizeMb} MB`);
    const extra = {
      caption: `✅ Tayyor!\n📦 Hajmi: ${sizeMb} MB` + (BOT_USERNAME ? `\n🤖 @${BOT_USERNAME}` : ""),
      reply_markup: inline([[{ text: "📥 Yana yuklash", callback_data: "new" }]]),
    };

    if (isAudio) {
      await tg.sendAudio(chatId, { source: buffer, filename: "audio.mp3" }, extra);
    } else {
      const file = { source: buffer, filename: "video.mp4" };
      try {
        await tg.sendVideo(chatId, file, { ...extra, supports_streaming: true });
      } catch (error) {
        console.error("sendVideo ishlamadi, fayl sifatida yuborilmoqda:", error.message);
        await tg.sendDocument(chatId, file, extra);
      }
    }

    await saveStatus("success", { fileSizeBytes: buffer.length });
    await removeMessage(chatId, progressId);
  } catch (error) {
    console.error("Video yuklab olishda xatolik:", error.message);
    await saveStatus("failed", { errorMessage: error.message });
    await showDownloadError(chatId, progressId, jobToken, job, error);
  } finally {
    clearInterval(actionTimer);
    activeDownloads.delete(from.id);
  }
}

async function showDownloadError(chatId, messageId, jobToken, job, error) {
  let text;
  const rows = [];

  if (error.code === "TOO_LARGE") {
    const size = error.sizeMb ? ` (${error.sizeMb} MB)` : "";
    text = `📦 <b>Video juda katta${size}</b>\n\nTelegram bot orqali 50 MB gacha fayl yuborish mumkin.`;

    if (error.downloadUrl && error.downloadUrl.length < 1500) {
      text += `\n\n🔗 Videoni brauzer orqali yuklab olishingiz mumkin (havola qisqa muddat amal qiladi).`;
      rows.push([{ text: "🔗 Brauzerda yuklab olish", url: error.downloadUrl }]);
    }

    if (HAS_QUALITY.includes(job.platform)) {
      const ladder = ["1080p", "720p", "480p", "360p"];
      const index = ladder.indexOf(job.format);
      const lower = index === -1 ? [] : ladder.slice(index + 1, index + 3);
      if (job.format !== "mp3") lower.push("mp3");
      text += `\n\n👇 Yoki pastroq sifat / MP3 tanlang:`;
      rows.push(...qualityRows(jobToken, lower));
    }
  } else {
    text = `😔 <b>Video yuklab bo'lmadi</b>\n\n${esc(error.userMessage || "Kutilmagan xatolik yuz berdi.")}`;
    rows.push([{ text: "🔄 Qayta urinish", callback_data: `dl:${jobToken}:auto` }]);
  }

  rows.push([{ text: "📥 Boshqa video", callback_data: "new" }]);
  await show(chatId, messageId, text, rows);
}

/* ------------------------------------------------------------------ */
/*  Middleware                                                         */
/* ------------------------------------------------------------------ */

// Faqat shaxsiy chat; foydalanuvchini bazadan olamiz (yo'q bo'lsa yaratamiz)
bot.use(async (ctx, next) => {
  if (ctx.chat?.type !== "private" || !ctx.from || ctx.from.is_bot) return;
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  ctx.state.user = await ensureUser(ctx.from);
  return next();
});

/* ------------------------------------------------------------------ */
/*  Buyruqlar va menyu tugmalari                                       */
/* ------------------------------------------------------------------ */

bot.command(["start", "menu"], (ctx) => {
  userStates.delete(ctx.from.id);
  return showWelcome(ctx.chat.id, ctx.state.user);
});

bot.command("help", (ctx) => {
  userStates.delete(ctx.from.id);
  return showHelp(ctx.chat.id);
});
bot.hears(BTN.help, (ctx) => {
  userStates.delete(ctx.from.id);
  return showHelp(ctx.chat.id);
});

const cancel = (ctx) => {
  userStates.delete(ctx.from.id);
  return send(ctx.chat.id, "👌 Bekor qilindi. Video havolasini yuborishingiz mumkin 🔗", mainKeyboard());
};
bot.command("cancel", cancel);
bot.hears(BTN.cancel, cancel);

const download = (ctx) => {
  userStates.delete(ctx.from.id);
  return showPlatformPicker(ctx.chat.id);
};
bot.command("download", download);
bot.hears(BTN.download, download);

const profile = (ctx) => {
  userStates.delete(ctx.from.id);
  return showProfile(ctx.chat.id, ctx.state.user);
};
bot.command("profile", profile);
bot.hears(BTN.profile, profile);

/* ------------------------------------------------------------------ */
/*  Oddiy xabarlar (ism / telefon / havola)                            */
/* ------------------------------------------------------------------ */

bot.on("message", async (ctx) => {
  const chatId = ctx.chat.id;
  const from = ctx.from;
  const user = ctx.state.user;
  const message = ctx.message;
  const text = typeof message.text === "string" ? message.text.trim() : "";

  if (text.startsWith("/")) {
    return send(chatId, "🤷 Noma'lum buyruq. Menyudan foydalaning yoki /start yuboring.", mainKeyboard());
  }

  const state = userStates.get(from.id);

  if (state?.step === "editName") {
    if (!text || text.length > 50) {
      return send(chatId, "⚠️ Ism 1 dan 50 belgigacha bo'lishi kerak. Qaytadan yozing:");
    }
    await users.updateUser(from.id, { username: text });
    userStates.delete(from.id);
    await send(chatId, "✅ Ismingiz yangilandi!", mainKeyboard());
    return showProfile(chatId, { ...user, username: text });
  }

  if (state?.step === "editPhone") {
    const phone = message.contact?.phone_number || text;
    if ((message.contact && message.contact.user_id !== from.id) || !validPhone(phone)) {
      return send(chatId, "⚠️ Raqam noto'g'ri. Tugma orqali ulashing yoki +998901234567 ko'rinishida yozing.");
    }
    await users.updateUser(from.id, { phonenumber: phone });
    userStates.delete(from.id);
    await send(chatId, "✅ Telefon raqamingiz yangilandi!", mainKeyboard());
    return showProfile(chatId, { ...user, phonenumber: phone });
  }

  const link = extractUrl(text);
  if (link) return handleLink(chatId, from, link);

  return send(
    chatId,
    "🤔 Menga <b>video havolasi</b> kerak.\n\nHavolani nusxalab shu yerga yuboring yoki platformani tanlang 👇",
    inline(platformRows()),
  );
});

/* ------------------------------------------------------------------ */
/*  Inline tugmalar (callback)                                         */
/* ------------------------------------------------------------------ */

const ids = (ctx) => ({ chatId: ctx.chat.id, messageId: ctx.callbackQuery.message.message_id });

bot.action("new", (ctx) => showPlatformPicker(ctx.chat.id)); // yangi xabar - videoni o'chirmaydi
bot.action("pick", (ctx) => showPlatformPicker(...Object.values(ids(ctx))));

bot.action(/^pf:(\w+)$/, async (ctx) => {
  const platform = PLATFORMS[ctx.match[1]];
  if (!platform) return;
  const { chatId, messageId } = ids(ctx);
  await edit(
    chatId,
    messageId,
    `${platform.icon} <b>${platform.name}</b>\n\n🔗 Video havolasini yuboring.\n\n<i>Masalan:</i>\n<code>${platform.example}</code>`,
    [[{ text: "⬅️ Orqaga", callback_data: "pick" }]],
  );
});

bot.action(/^dl:(\w+):(\w+)$/, (ctx) => {
  const [, jobToken, value] = ctx.match;
  const format = DOWNLOAD_FORMATS.some((f) => f.id === value) ? value : undefined; // "auto" -> eski format
  const { chatId, messageId } = ids(ctx);
  return runDownload(chatId, ctx.from, jobToken, { format, messageId });
});

bot.action(/^cancel:(\w+)$/, async (ctx) => {
  pendingJobs.delete(ctx.match[1]);
  const { chatId, messageId } = ids(ctx);
  await removeMessage(chatId, messageId);
});

bot.action("profile", (ctx) => {
  userStates.delete(ctx.from.id);
  const { chatId, messageId } = ids(ctx);
  return showProfile(chatId, ctx.state.user, messageId);
});

bot.action("profile:edit_name", async (ctx) => {
  userStates.set(ctx.from.id, { step: "editName" });
  const { chatId, messageId } = ids(ctx);
  await edit(chatId, messageId, "✏️ <b>Yangi ismingizni yozing:</b>", [
    [{ text: BTN.cancel, callback_data: "profile" }],
  ]);
});

bot.action("profile:edit_phone", async (ctx) => {
  userStates.set(ctx.from.id, { step: "editPhone" });
  await send(ctx.chat.id, "📱 Yangi telefon raqamingizni ulashing yoki yozing:", {
    keyboard: [[{ text: "📱 Raqamni ulashish", request_contact: true }], [{ text: BTN.cancel }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  });
});

bot.action("profile:delete", async (ctx) => {
  userStates.delete(ctx.from.id);
  const { chatId, messageId } = ids(ctx);
  await edit(
    chatId,
    messageId,
    "⚠️ <b>Ishonchingiz komilmi?</b>\n\nHisobingiz va barcha ma'lumotlaringiz butunlay o'chiriladi.",
    [
      [{ text: "🗑 Ha, o'chirish", callback_data: "profile:delete_confirm" }],
      [{ text: "↩️ Yo'q, qolsin", callback_data: "profile" }],
    ],
  );
});

bot.action("profile:delete_confirm", async (ctx) => {
  await users.deleteUser(ctx.from.id);
  userStates.delete(ctx.from.id);
  const { chatId, messageId } = ids(ctx);
  await edit(chatId, messageId, "✅ Hisobingiz va ma'lumotlaringiz o'chirildi.");
  await send(chatId, "👋 Xayr! Qaytmoqchi bo'lsangiz, /start yuboring.", { remove_keyboard: true });
});

/* ------------------------------------------------------------------ */
/*  Xatoliklar va ishga tushirish                                      */
/* ------------------------------------------------------------------ */

bot.catch((error, ctx) => {
  console.error("Telegram bot so'rovini bajarishda xatolik:", error.message);
  if (ctx?.chat?.id === undefined) return;
  send(ctx.chat.id, "😔 Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring yoki /start yuboring.").catch(
    (sendError) => console.error("Xatolik xabarini yuborib bo'lmadi:", sendError.message),
  );
});

process.on("unhandledRejection", (error) => {
  console.error("Kutilmagan xatolik:", error?.message || error);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => bot.stop(signal));
}

initializeDatabase()
  .then(async () => {
    const me = await tg.getMe(); // tokenni ham tekshiradi
    await tg
      .setMyCommands([
        { command: "start", description: "🏠 Bosh sahifa" },
        { command: "download", description: "📥 Video yuklash" },
        { command: "profile", description: "👤 Profilim" },
        { command: "help", description: "❓ Yordam" },
      ])
      .catch((error) => console.error("Buyruqlarni o'rnatib bo'lmadi:", error.message));

    bot.launch().catch((error) => {
      console.error("Botni ishga tushirib bo'lmadi:", error.message);
      process.exit(1);
    });
    console.log(`Bot ishga tushdi ✅ @${me.username}`);
  })
  .catch((error) => {
    console.error("Botni ishga tayyorlab bo'lmadi:", error.message);
    process.exit(1);
  });