// Photos for step fields (old part / new part…), stored in MongoDB GridFS – no extra storage service needed.
// The browser shrinks a photo to about 200–400 KB before it is sent.
const mongoose = require("mongoose");

const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // "RIFF"
};

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "uploads" });

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// "data:image/jpeg;base64,..." -> { buffer, contentType }
function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
  if (!m) throw badRequest("Send a JPEG, PNG or WebP photo");
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length) throw badRequest("The photo is empty");
  if (buffer.length > MAX_BYTES) throw badRequest("The photo is too large (max 3 MB)");
  const magic = TYPES[m[1]];
  if (!magic.every((b, i) => buffer[i] === b)) throw badRequest("The file is not a valid image");
  return { buffer, contentType: m[1] };
}

async function saveImage({ dataUrl, filename, userId }) {
  const { buffer, contentType } = decodeDataUrl(dataUrl);
  const name = String(filename || "photo").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "photo";
  return new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(name, { metadata: { contentType, uploadedBy: userId } });
    stream.on("error", reject);
    stream.on("finish", () => resolve({ id: String(stream.id), size: buffer.length, contentType }));
    stream.end(buffer);
  });
}

async function findImage(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const [file] = await bucket().find({ _id: new mongoose.Types.ObjectId(String(id)) }).toArray();
  return file || null;
}

const openImage = (id) => bucket().openDownloadStream(new mongoose.Types.ObjectId(String(id)));

module.exports = { saveImage, findImage, openImage, decodeDataUrl, MAX_BYTES };
