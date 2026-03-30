const mongoose = require("mongoose");

const dietSchema = new mongoose.Schema({
  userId: String,
  phase: String,
  calories: Number,
  plan: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Diet", dietSchema);
