import mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema.Types;

// MIDAP "Help Ticket": someone raises a problem, the solver fixes it within the category's TAT,
// the person who raised it confirms (closed) or reopens it.
//   open -> working -> solved -> closed      (cancelled by the person who raised it before it is solved)
// The solver's work is also a Task (kind "ticket"), so it shows in My Tasks, the dashboard and the MIS.
const ticketSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, unique: true }, // shown as HT-0001
    raisedBy: { type: ObjectId, ref: "User", required: true },
    category: { type: ObjectId, ref: "TicketCategory", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    location: { type: String, default: "" }, // machine / room / place
    photos: { type: [String], default: undefined }, // uploads ids
    priority: { type: String, enum: ["normal", "high", "critical"], default: "normal" },
    status: { type: String, enum: ["open", "working", "solved", "closed", "cancelled"], default: "open", index: true },
    solver: { type: ObjectId, ref: "User", index: true },
    task: { type: ObjectId, ref: "Task" },
    planned: Date, // solve by
    solvedAt: Date,
    closedAt: Date,
    autoClosed: Boolean, // closed because the person did not confirm in time
    solution: { type: String, default: "" },
    solutionPhotos: { type: [String], default: undefined },
    rating: Number, // 1-5 from the person who raised it, when they confirm
    reopenCount: { type: Number, default: 0 },
    history: { type: [{ _id: false, at: Date, by: { type: ObjectId, ref: "User" }, action: String, note: String }], default: undefined },
  },
  { timestamps: true }
);
ticketSchema.index({ raisedBy: 1, createdAt: -1 });
ticketSchema.index({ category: 1, status: 1 });

export = mongoose.model("Ticket", ticketSchema);
