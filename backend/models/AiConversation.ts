import mongoose = require("mongoose");

// One chat with the AI assistant. `messages` is the exact conversation sent to the model's API (append-only:
// earlier turns are never edited, so the model's own blocks stay valid); `turns` is what the chat page shows.
const aiConversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, default: "" },
    // which kind of model the chat was with ("anthropic", "groq", "gemini"…): its messages are in that format
    provider: { type: String, default: "anthropic" },
    messages: { type: [mongoose.Schema.Types.Mixed], default: [] },
    turns: {
      type: [
        {
          _id: false,
          role: { type: String, enum: ["user", "assistant"] },
          text: String,
          steps: [{ _id: false, tool: String, input: mongoose.Schema.Types.Mixed, ok: Boolean }],
          at: Date,
        },
      ],
      default: [],
    },
    usage: { input: { type: Number, default: 0 }, output: { type: Number, default: 0 }, cacheRead: { type: Number, default: 0 } },
  },
  { timestamps: true }
);

export = mongoose.model("AiConversation", aiConversationSchema);
