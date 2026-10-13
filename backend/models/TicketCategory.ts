import mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema.Types;

// Help Ticket category (IT, Maintenance, HR…): who solves it and in how long.
// A new ticket goes to the category's solver, else to its department's HOD, else it waits to be assigned.
const ticketCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "" },
    solver: { type: ObjectId, ref: "User" },
    department: { type: ObjectId, ref: "Department" },
    tatHours: { type: Number, default: 24 }, // working hours to solve
    priority: { type: String, enum: ["normal", "high", "critical"], default: "normal" }, // default for new tickets
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export = mongoose.model("TicketCategory", ticketCategorySchema);
