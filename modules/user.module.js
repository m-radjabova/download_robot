const { User, VideoDownload } = require("../config/db");

async function getUser(userId) {
  return User.findOne({ userid: userId })
    .select("userid username phonenumber")
    .lean();
}

async function saveUser(userId, username, phoneNumber) {
  await User.findOneAndUpdate(
    { userid: userId },
    { $set: { username, phonenumber: phoneNumber } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

async function updateUser(userId, fields) {
  const updates = {};
  if (fields.username !== undefined) updates.username = fields.username;
  if (fields.phonenumber !== undefined) updates.phonenumber = fields.phonenumber;
  if (Object.keys(updates).length === 0) return;

  await User.updateOne({ userid: userId }, { $set: updates }, { runValidators: true });
}

async function deleteUser(userId) {
  await VideoDownload.deleteMany({ userid: userId });
  await User.deleteOne({ userid: userId });
}

async function createDownload(userId, sourceUrl, platform, telegramUsername) {
  const download = await VideoDownload.create({
    userid: userId,
    telegramUsername,
    sourceUrl,
    platform,
    status: "processing",
  });
  return download._id.toString();
}

async function setDownloadStatus(userId, downloadId, status, details = {}) {
  if (status !== "success" && status !== "failed") {
    throw new Error(`Yuklab olish holati noto'g'ri: ${status}`);
  }

  const update = {
    $set: {
      status,
      completedAt: new Date(),
    },
  };
  if (status === "failed") {
    update.$unset = { fileSizeBytes: 1 };
    if (details.errorMessage) {
      update.$set.errorMessage = details.errorMessage.slice(0, 500);
    }
  } else {
    if (!Number.isInteger(details.fileSizeBytes) || details.fileSizeBytes <= 0) {
      throw new Error("Video hajmi MongoDB'ga yozish uchun noto'g'ri.");
    }
    update.$set.fileSizeBytes = details.fileSizeBytes;
    update.$unset = { errorMessage: 1 };
  }

  const result = await VideoDownload.updateOne(
    { userid: userId, _id: downloadId },
    update,
    { runValidators: true },
  );
  if (result.matchedCount === 0) {
    throw new Error("MongoDB'da yuklab olish yozuvi topilmadi.");
  }
}

module.exports = {
  createDownload,
  deleteUser,
  getUser,
  saveUser,
  setDownloadStatus,
  updateUser,
};
