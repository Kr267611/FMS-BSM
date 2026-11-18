import mongoose = require("mongoose");

// The AI assistant's knowledge (RAG): text pieces ("chunks") from Google Drive files and from the app itself
// (FMS steps' How, checklist instructions, the app's rules), with an embedding vector for meaning search.
const knowledgeChunkSchema = new mongoose.Schema({
  source: { type: String, enum: ["drive", "app"], required: true },
  sourceId: { type: String, required: true, index: true }, // Drive file id, "fms:<id>", "checklist:<id>", "rules"
  title: { type: String, default: "" },
  link: { type: String, default: "" },
  chunk: { type: Number, default: 0 },
  text: { type: String, required: true },
  embedding: { type: Buffer, default: undefined }, // Float32 vector, unit length
  embedModel: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

// One row per source: when it was indexed and from which version, so unchanged Drive files are skipped
const knowledgeSourceSchema = new mongoose.Schema({
  sourceId: { type: String, required: true, unique: true },
  source: { type: String, enum: ["drive", "app"], required: true },
  title: { type: String, default: "" },
  link: { type: String, default: "" },
  version: { type: String, default: "" }, // Drive modifiedTime, or a hash of the app text
  embedModel: { type: String, default: "" },
  chunks: { type: Number, default: 0 },
  error: { type: String, default: "" },
  indexedAt: { type: Date, default: Date.now },
});

const KnowledgeChunk = mongoose.model("KnowledgeChunk", knowledgeChunkSchema);
const KnowledgeSource = mongoose.model("KnowledgeSource", knowledgeSourceSchema);
export = { KnowledgeChunk, KnowledgeSource };
