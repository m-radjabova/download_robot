# Telegram video bot

Bot foydalanuvchidan ism va telefon raqamini oladi, MongoDB'da saqlaydi va video havolasidan video yuklab beradi. Yuklab olishlar tarixi botda ko'rsatilmaydi, ammo har bir to'g'ri video havolasi va uning natijasi MongoDB'da saqlanadi.

## Ishga tushirish

1. `npm install` buyrug'ini bajaring.
2. MongoDB Atlas'da bepul cluster yarating va **Database Access** bo'limida database user yarating.
3. **Network Access** bo'limida serveringizning IP manziliga ruxsat bering.
4. Cluster'dan **Connect → Drivers → Node.js** ni tanlab, connection string'ni nusxalang.
5. `.env.example` faylidan `.env` yarating (`cp .env.example .env`) va `TOKEN`, `RAPIDAPI_KEY`, `RAPIDAPI_HOST`, `FACEBOOK_API_HOST` hamda Atlas manzilini `MONGODB_URI` qatoriga kiriting. `<db_user>`, `<db_password>` va `cluster0.xxxxx` qismlarini Atlas bergan qiymatlar bilan almashtiring. Parolda `@`, `/` kabi belgilar bo'lsa, URL-encode qiling. `.env` va boshqa `.env.*` fayllari Git tomonidan e'tiborsiz qoldiriladi; GitHub'ga faqat maxfiy qiymatlarsiz `.env.example` yuboriladi.
6. `npm start` buyrug'ini bajaring. Bot kerakli collection va indexlarni o'zi yaratadi.

retryWrites=true&w=majority`

`RAPIDAPI_HOST` Instagram, YouTube va TikTok API hostini, `FACEBOOK_API_HOST` esa faqat Facebook RapidAPI host nomini belgilaydi (masalan, `facebook-reels-and-video-downloader.p.rapidapi.com`; `https://` yoki `/facebook` qo'shmang). YouTube va TikTok uchun `POST /youtube/download` hamda `POST /tiktok/download` endpointlari `{ "url": "...", "format": "720p" }` shaklidagi JSON qabul qiladi. YouTube'da media server `403` qaytarsa, bot yangi API havolasini bir marta olib qayta urinadi. `format` sifatida MP3 ham tanlash mumkin. Facebook API `GET /facebook?url=...` endpointidan foydalanadi. `.env` ichidagi qiymatlarni boshqalar bilan ulashmang. RapidAPI kaliti faqat `.env` ichida saqlanadi; uni kod yoki repozitoriyga qo'shmang. Bot `/start`, `/menu` va `/cancel` buyruqlarini qo'llaydi.

## MongoDB'da saqlanadigan ma'lumotlar

- `users` — Telegram foydalanuvchi ID'si, botga kiritgan ism va telefon raqami.
- `video_downloads` — foydalanuvchi ID'si, Telegram username (bo'lsa), platforma (`instagram`, `youtube`, `facebook` yoki `tiktok`), video havolasi, fayl hajmi (bayt), holati, xatolik sababi (muvaffaqiyatsiz bo'lsa), yaratilgan va tugagan vaqt.

Har bir video yozuvi Telegram `userid` va platforma bilan bog'lanadi. Platforma havolaga qarab aniqlanib, majburiy maydon sifatida saqlanadi. Muvaffaqiyatli videoning fayl hajmi ham bazaga bayt ko'rinishida yoziladi va bot uni foydalanuvchiga MB'da ko'rsatadi. Yozuvlar urinish boshlanishi bilan `processing` holatida yaratiladi, yakunda `success` yoki `failed` bo'ladi. Shu sababli muvaffaqiyatsiz yuklashlar ham saqlanadi. MongoDB TTL index yozuvlarni yaratilgan vaqtidan 3 kun o'tgach avtomatik o'chiradi (MongoDB tozalash jarayoni vaqti-vaqti bilan ishlaydi, shu bois o'chirish aynan soniyasida bo'lmasligi mumkin). MongoDB Atlas yoki Compass'da `video_downloads` collection'ini ochib yozuvlarni ko'rish va `userid`, `platform`, `status`, sana bo'yicha filtrlash mumkin. Foydalanuvchi profilini botdan butunlay o'chirishni tasdiqlasa, uning profili va amaldagi yuklab olish yozuvlari ham o'chiriladi.

Yuklanish vaqtida Telegram'dagi `upload_video` animatsiyasi ko'rsatiladi. Qo'shimcha animatsion sticker yuborish uchun `.env` ichidagi ixtiyoriy `LOADING_STICKER_ID` qiymatiga Telegram sticker `file_id` sini yozing.

Shaxsiy chatda foydalanuvchining yuborgan xabari va botning oldingi ekrani keyingi amal boshlanganda avtomatik o'chiriladi; yangi javob va natija qoladi. Guruh chatlarida xabarlar o'chirilmaydi.
