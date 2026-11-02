const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    userid: { type: Number, required: true, unique: true },
    username: { type: String, required: true, trim: true, maxlength: 50 },
    phonenumber: { type: String, required: true, trim: true, maxlength: 20 },
  },
  { timestamps: true },
);

const videoDownloadSchema = new mongoose.Schema(
  {
    userid: { type: Number, required: true },
    telegramUsername: { type: String, trim: true, maxlength: 32 },
    sourceUrl: { type: String, required: true, maxlength: 2048 },
    platform: {
      type: String,
      enum: ["instagram", "youtube", "facebook", "tiktok"],
      required: true,
    },
    status: {
      type: String,
      enum: ["processing", "success", "failed"],
      required: true,
    },
    errorMessage: { type: String, trim: true, maxlength: 500 },
    fileSizeBytes: { type: Number, min: 1, max: 50 * 1024 * 1024 },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

videoDownloadSchema.index({ userid: 1, createdAt: -1 });
videoDownloadSchema.index({ userid: 1, platform: 1, createdAt: -1 });
videoDownloadSchema.index({ status: 1, createdAt: -1 });
videoDownloadSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 3 * 24 * 60 * 60, name: "video_downloads_ttl_3_days" },
);

const User =
  mongoose.models.User || mongoose.model("User", userSchema, "users");
const VideoDownload =
  mongoose.models.VideoDownload ||
  mongoose.model("VideoDownload", videoDownloadSchema, "video_downloads");

async function initializeDatabase() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) {
    throw new Error("MONGODB_URI .env faylida berilmagan.");
  }

  await mongoose.connect(uri);
  await Promise.all([User.init(), VideoDownload.init()]);
  console.log("MongoDB ulandi ✅");
}

module.exports = { initializeDatabase, mongoose, User, VideoDownload };
