const express = require("express");
const { auth } = require("../middleware/auth");
const { rateLimit } = require("../services/session");
const { saveImage, findImage, openImage } = require("../services/uploads");

const router = express.Router();

// Photos arrive as a data URL in JSON, so this route accepts a bigger body than the rest of the API
router.post(
  "/",
  express.json({ limit: "5mb" }),
  auth,
  rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many photos at once. Wait a minute and try again." }),
  async (req, res) => {
    const saved = await saveImage({ dataUrl: req.body?.data, filename: req.body?.name, userId: req.user._id });
    res.status(201).json(saved);
  }
);

router.get("/:id", auth, async (req, res) => {
  const file = await findImage(req.params.id);
  if (!file) return res.status(404).json({ message: "Photo not found" });
  res.setHeader("Content-Type", file.metadata?.contentType || "application/octet-stream");
  res.setHeader("Content-Length", file.length);
  res.setHeader("Cache-Control", "private, max-age=604800, immutable");
  openImage(file._id)
    .on("error", () => res.destroy())
    .pipe(res);
});

module.exports = router;
