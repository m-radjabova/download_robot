// config/api.js — Instagram, TikTok, YouTube (RAPIDAPI_HOST) va Facebook (FACEBOOK_API_HOST)

const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // Telegram limiti
const DOWNLOAD_FORMATS = ["144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "2160p", "mp3"];

/** message - logga, userMessage - foydalanuvchiga ko'rsatiladi */
class BotError extends Error {
  constructor(message, userMessage, extra = {}) {
    super(message);
    this.name = "BotError";
    this.userMessage = userMessage || message;
    Object.assign(this, extra);
  }
}

function env(name) {
  const value = process.env[name];
  if (!value) {
    throw new BotError(`${name} .env faylida yo'q`, "Bot hozircha sozlanmagan. Administrator bilan bog'laning.");
  }
  return value;
}

function facebookApiHost() {
  const host = env("FACEBOOK_API_HOST");
  if (host.includes("://") || host.includes("/")) {
    throw new BotError(
      "FACEBOOK_API_HOST faqat host bo'lishi kerak; URL va /facebook yo'lini yozmang.",
      "FACEBOOK_API_HOST qiymatiga faqat RapidAPI host nomini yozing.",
    );
  }
  return host;
}

/* ------------------------------------------------------------------ */
/*  Havola bilan ishlash                                               */
/* ------------------------------------------------------------------ */

/** Matn ichidan birinchi havolani topadi. */
function extractUrl(text) {
  if (typeof text !== "string") return null;
  const withScheme = text.match(/https?:\/\/[^\s]+/i);
  if (withScheme) return withScheme[0].replace(/[)\].,;!?]+$/, "");

  const bare = text.match(
    /\b((?:www\.|m\.)?(?:instagram\.com|instagr\.am|youtube\.com|youtu\.be|facebook\.com|fb\.watch|fb\.com)\/[^\s]+|(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s]+)/i,
  );
  return bare ? `https://${bare[1].replace(/[)\].,;!?]+$/, "")}` : null;
}

function detectPlatform(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BotError("Invalid URL", "Havola noto'g'ri. To'liq video havolasini yuboring.");
  }
  const host = url.hostname.toLowerCase();
  const is = (d) => host === d || host.endsWith(`.${d}`);

  if (is("instagram.com") || is("instagr.am")) return "instagram";
  if (is("youtube.com") || host === "youtu.be") return "youtube";
  if (is("facebook.com") || is("fb.com") || host === "fb.watch") return "facebook";
  if (is("tiktok.com")) return "tiktok";

  throw new BotError(
    "Unsupported platform",
    "Faqat Instagram, YouTube, Facebook yoki TikTok havolalari qo'llab-quvvatlanadi.",
  );
}

function validateVideoUrl(value, expectedPlatform) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new BotError("URL too long", "Havola juda uzun.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BotError("Invalid URL", "Havola noto'g'ri. To'liq video havolasini yuboring.");
  }

  const host = url.hostname.toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new BotError("Blocked URL", "Faqat ochiq HTTP yoki HTTPS video havolasini yuboring.");
  }

  const platform = detectPlatform(url.toString());
  if (expectedPlatform && platform !== expectedPlatform) {
    throw new BotError("Platform mismatch", "Havola tanlangan platformaga mos kelmadi.");
  }

  if (platform === "instagram") {
    if (!/^\/(?:[^/]+\/)?(?:share\/)?(?:reel|reels|p|tv)\/[^/]+\/?$/i.test(url.pathname)) {
      throw new BotError(
        "Bad Instagram path",
        "Instagram Reel yoki post havolasini yuboring (masalan: instagram.com/reel/...).",
      );
    }
    url.search = "";
    url.hash = "";
  }
  return url.toString();
}

/* ------------------------------------------------------------------ */
/*  RapidAPI                                                           */
/* ------------------------------------------------------------------ */

function apiError(status, detail = "") {
  let userMessage;
  if (status === 400 || status === 422) userMessage = "Bu havoladan video topilmadi. Video ochiq (public) ekanini tekshiring.";
  else if ([401, 403, 429].includes(status)) userMessage = "Xizmat hozir band. Birozdan so'ng qayta urinib ko'ring.";
  else if (status === 404) userMessage = "Video topilmadi. Havola to'g'riligini tekshiring.";
  else if (status >= 500) userMessage = "Video xizmati vaqtincha ishlamayapti. Birozdan so'ng qayta urinib ko'ring.";
  else userMessage = "Videoni olib bo'lmadi. Boshqa havola bilan urinib ko'ring.";
  return new BotError(`Video API xatosi (HTTP ${status}) ${String(detail).slice(0, 200)}`, userMessage, { status });
}

/** RapidAPI ga GET yoki JSON POST so'rov yuboradi va JSON qaytaradi. */
async function callApi(host, path, { params = {}, body } = {}) {
  const url = new URL(`https://${host}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const headers = { "x-rapidapi-key": env("RAPIDAPI_KEY"), "x-rapidapi-host": host };
  if (body) headers["content-type"] = "application/json";

  let response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    throw new BotError(
      `API ga ulanib bo'lmadi (${host}): ${error.message}`,
      "Video xizmati javob bermadi. Birozdan so'ng qayta urinib ko'ring.",
    );
  }

  const text = await response.text();
  if (!response.ok) throw apiError(response.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new BotError(`API JSON qaytarmadi (${host})`, "Video xizmatidan noto'g'ri javob keldi. Qayta urinib ko'ring.");
  }
}

const noVideo = (details) =>
  new BotError(
    `Yuklab olish havolasi topilmadi. ${details || ""}`,
    "Bu havoladan video topilmadi. Video ochiq (public) ekanini tekshiring.",
  );

/** API javobining tuzilishini logga yozish uchun qisqa tavsif (faqat konsol uchun). */
function describePayload(payload) {
  const lines = [];
  const queue = [{ value: payload, path: "response" }];

  while (queue.length && lines.length < 40) {
    const { value, path } = queue.shift();
    if (!value || typeof value !== "object") continue;

    for (const [key, nested] of Object.entries(value)) {
      const childPath = `${path}.${JSON.stringify(String(key).slice(0, 40))}`;
      let brief;
      if (typeof nested === "string") brief = `string(${nested.length})`;
      else if (Array.isArray(nested)) brief = `array(${nested.length})`;
      else brief = typeof nested;
      lines.push(`${childPath}=${brief}`);
      if (nested && typeof nested === "object") queue.push({ value: nested, path: childPath });
      if (lines.length >= 40) break;
    }
  }
  return lines.join(" | ");
}

const KEYS = [
  "downloadurl",
  "downloadlink",
  "downloadhighquality",
  "downloadhdquality",
  "downloadmediumquality",
  "downloadlowquality",
  "download",
  "videourl",
  "videolink",
  "hdvideourl",
  "hdvideo",
  "hdplay",
  "hd",
  "play",
  "sdvideourl",
  "sdvideo",
  "sd",
  "mediaurl",
  "playbackurl",
  "playurl",
  "fileurl",
  "audiourl",
  "audio",
  "mp3",
  "music",
  "video",
  "link",
  "src",
  "url",
];

const isFacebookPage = (host) =>
  host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com" || host.endsWith(".fb.com") || host === "fb.watch";

/**
 * API javobidan yuklab olish havolasini topadi.
 *  audio  - true bo'lsa faqat audio (MP3), aks holda faqat video qaytaradi
 *  height - so'ralgan sifat (javobda sifat ko'rsatilgan bo'lsa, shunga eng yaqini tanlanadi)
 * Kalit nomlari bo'shliq va belgilarsiz solishtiriladi ("Download High Quality" = downloadhighquality).
 */
function findUrl(payload, sourceUrl, { audio = false, height: want = 2160 } = {}) {
  const found = [];
  const queue = [{ value: payload, depth: 0 }];

  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object") continue;

    // shu obyektda sifat ko'rsatilganmi? (height / quality / resolution ...)
    const label = String(value.height ?? value.quality ?? value.qualityLabel ?? value.resolution ?? value.label ?? "");
    const nums = (label.match(/\d{3,4}/g) || []).map(Number);
    const height = nums.length ? Math.min(...nums) : 0;
    const info = [value.type, value.mimeType, value.mime_type, value.ext, value.format].join(" ");

    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === "string") {
        const name = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        const rank = KEYS.indexOf(name);
        if (rank === -1 || !/^https?:\/\//i.test(nested) || nested === sourceUrl) continue;

        let host;
        try {
          host = new URL(nested).hostname.toLowerCase();
        } catch {
          continue;
        }
        if (isFacebookPage(host)) continue; // bu video emas, Facebook sahifasi

        const isAudio = /audio|mp3|m4a|music/i.test(`${name} ${info} ${nested.split("?")[0]}`);
        found.push({ rank, depth, height, isAudio, name, url: nested });
      } else if (nested && typeof nested === "object") {
        queue.push({ value: nested, depth: depth + 1 });
      }
    }
  }

  let pool = found.filter((item) => item.isAudio === audio);
  if (audio && !pool.length) {
    pool = found.filter((item) => ["downloadurl", "downloadlink", "download"].includes(item.name));
  }
  if (!pool.length) return null;

  const withHeight = pool.filter((item) => item.height);
  if (!audio && withHeight.length) {
    const fits = withHeight.filter((item) => item.height <= want).sort((a, b) => b.height - a.height || a.rank - b.rank);
    const list = fits.length ? fits : withHeight.sort((a, b) => a.height - b.height || a.rank - b.rank);
    return list[0].url;
  }

  pool.sort((a, b) => a.rank - b.rank || a.depth - b.depth);
  return pool[0].url;
}

/* ------------------------------------------------------------------ */
/*  Platformalar                                                       */
/* ------------------------------------------------------------------ */

// Instagram, TikTok, YouTube: RAPIDAPI_HOST dagi GET /get-info-rapidapi?url=...
async function viaMainApi(url, format) {
  const host = env("RAPIDAPI_HOST");
  const data =
    format === "best"
      ? await callApi(host, "/get-info-rapidapi", { params: { url } })
      : await callApi(host, "/youtube/download", { body: { url, format } });
  const link = findUrl(data, url, { audio: format === "mp3", height: parseInt(format) || 2160 });
  if (!link) throw noVideo(`API javob tuzilishi: ${describePayload(data) || typeof data}`);
  return link;
}

async function viaTikTokApi(url, format) {
  const data = await callApi(env("RAPIDAPI_HOST"), "/tiktok/download", {
    body: { url, format },
  });
  const link = findUrl(data, url, { audio: format === "mp3", height: parseInt(format) || 2160 });
  if (!link) throw noVideo(`API javob tuzilishi: ${describePayload(data) || typeof data}`);
  return link;
}

// Facebook: FACEBOOK_API_HOST dagi GET /facebook?url=...
async function viaFacebookApi(url) {
  const data = await callApi(facebookApiHost(), "/facebook", { params: { url } });
  const link = findUrl(data, url);
  if (!link) throw noVideo(`API javob tuzilishi: ${describePayload(data) || typeof data}`);
  return link;
}

/** Yuklab olish havolasini qaytaradi. */
async function downloadVideo(videoUrl, platform = detectPlatform(videoUrl), options = {}) {
  const url = validateVideoUrl(videoUrl, platform);
  const format = DOWNLOAD_FORMATS.includes(options.format) ? options.format : "720p";

  if (platform === "facebook") return viaFacebookApi(url);
  if (platform === "instagram") return viaMainApi(url, "best");
  if (platform === "youtube") return viaMainApi(url, format);
  if (platform === "tiktok") return viaTikTokApi(url, format);
  throw new BotError("Unsupported platform", "Bu platforma qo'llab-quvvatlanmaydi.");
}

/* ------------------------------------------------------------------ */
/*  Faylni yuklab olish (50 MB gacha)                                  */
/* ------------------------------------------------------------------ */

async function downloadMediaFile(downloadUrl) {
  let url;
  try {
    url = new URL(downloadUrl);
  } catch {
    throw new BotError("Invalid download URL", "Video havolasi noto'g'ri qaytdi. Qayta urinib ko'ring.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new BotError("Unsafe download URL", "Video havolasi xavfsiz emas. Qayta urinib ko'ring.");
  }

  const tooLarge = (sizeMb) =>
    new BotError("Fayl 50 MB dan katta", "Video 50 MB dan katta.", {
      code: "TOO_LARGE",
      sizeMb,
      downloadUrl: url.toString(),
    });

  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; TelegramVideoBot/1.0)" },
    });
  } catch (error) {
    const cause = error.cause;
    const causeCode = cause?.code || error.code;
    throw new BotError(
      `Faylni yuklab bo'lmadi (${url.hostname}): ${error.message}${causeCode ? ` [${causeCode}]` : ""}`,
      "Video serveriga ulanib bo'lmadi. Birozdan so'ng qayta urinib ko'ring.",
    );
  }
  if (!response.ok || !response.body) {
    throw new BotError(
      `Fayl serveri ${url.hostname} HTTP ${response.status} qaytardi`,
      response.status === 403
        ? "Video serveri yuklab olishni rad etdi. Video havolasi eskirgan yoki tanlangan sifatni server bermayapti."
        : "Videoni yuklab olib bo'lmadi. Qayta urinib ko'ring.",
      { status: response.status },
    );
  }

  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const okType =
    !contentType ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/") ||
    ["application/octet-stream", "application/mp4"].includes(contentType);
  if (!okType) {
    await response.body.cancel().catch(() => {});
    if (contentType === "text/html") {
      const finalHost = response.url ? new URL(response.url).hostname : url.hostname;
      throw new BotError(
        `Video URL HTML sahifaga yo'naltirdi (${finalHost}).`,
        "Video fayli o'rniga veb-sahifa qaytdi. Video hammaga ochiqligini tekshiring yoki to'g'ridan-to'g'ri video havolasini yuboring.",
      );
    }
    throw new BotError(
      `Kutilmagan content-type: ${contentType}`,
      "Server video o'rniga boshqa narsa qaytardi. Qayta urinib ko'ring.",
    );
  }

  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_VIDEO_SIZE) {
    await response.body.cancel().catch(() => {});
    throw tooLarge((length / 1024 / 1024).toFixed(1));
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_VIDEO_SIZE) {
        await reader.cancel().catch(() => {});
        throw tooLarge(null);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  if (size === 0) throw new BotError("Fayl bo'sh", "Video fayli bo'sh keldi. Qayta urinib ko'ring.");
  return { buffer: Buffer.concat(chunks, size), contentType: contentType || "video/mp4" };
}

async function downloadVideoFile(videoUrl, platform, options = {}) {
  const downloadUrl = await downloadVideo(videoUrl, platform, options);
  try {
    return await downloadMediaFile(downloadUrl);
  } catch (error) {
    if (platform !== "youtube" || error.status !== 403) throw error;

    const refreshedUrl = await downloadVideo(videoUrl, platform, options);
    try {
      return await downloadMediaFile(refreshedUrl);
    } catch (retryError) {
      if (retryError.status === 403) {
        throw new BotError(
          `${retryError.message}. Yangi API havolasi bilan qayta urinish ham 403 qaytardi.`,
          "YouTube video serveri yuklab olishni rad etdi. Boshqa sifatni tanlang yoki keyinroq urinib ko'ring.",
          { status: retryError.status },
        );
      }
      throw retryError;
    }
  }
}

module.exports = {
  BotError,
  MAX_VIDEO_SIZE,
  DOWNLOAD_FORMATS,
  detectPlatform,
  describePayload,
  downloadMediaFile,
  downloadVideo,
  downloadVideoFile,
  extractUrl,
  findUrl,
  validateVideoUrl,
};