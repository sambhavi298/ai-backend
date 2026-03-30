require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const compression = require("compression");

const User = require("./models/User");
const Diet = require("./models/Diet");

const app = express();

// --- Production Middlewares ---
app.use(helmet()); // Secure HTTP headers
app.use(compression()); // Gzip compression
app.use(morgan("dev")); // Request logging
app.use(cors());
app.use(express.json());

// API Rate Limiting (Prevents brute force & abuse)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: { error: "Too many requests, please try again later." }
});
app.use("/login", limiter); // Stricter limit for auth
app.use("/register", limiter);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error("MongoDB Connection Error:", err));

app.get("/", (req, res) => {
  res.send("CycleSync API - Running in Production Mode");
});

const API_KEY = process.env.OPENAI_API_KEY;

// --- Global Error Handler Utility ---
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Authentication Middleware
function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Access denied. No token provided." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (ex) {
    res.status(400).json({ error: "Invalid token." });
  }
}

// Admin Middleware
async function adminAuth(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden. Admin access required." });
    }
    next();
  } catch (err) {
    next(err);
  }
}

// --- Auth Routes ---
app.post("/register", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const hashed = await bcrypt.hash(password, 10);
  const role = email === "sambhavi2908@gmail.com" ? "admin" : "user";
  
  const user = await User.create({ email, password: hashed, role });
  res.status(201).json({ message: "User registered", id: user._id });
}));

app.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  
  if (!user) return res.status(400).json({ error: "Invalid email or password" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Invalid email or password" });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, role: user.role });
}));

// --- CycleSync Features ---
app.post("/diet", auth, asyncHandler(async (req, res) => {
  const { phase, calories, likes, dislikes } = req.body;

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Create a ${calories} kcal diet plan for ${phase}. Likes: ${likes}. Avoid: ${dislikes}`
      }]
    },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const plan = response.data.choices[0].message.content;
  const insight = calories < 1200 ? "Warning: Calorie intake is critically low." : null;

  await Diet.create({ userId: req.userId, phase, calories, plan });
  res.json({ plan, insight });
}));

app.post("/chat", auth, asyncHandler(async (req, res) => {
  const { message } = req.body;
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a health assistant specializing in cycle sync health." },
        { role: "user", content: message }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );
  res.json(response.data);
}));

app.get("/history", auth, asyncHandler(async (req, res) => {
  const diets = await Diet.find({ userId: req.userId }).sort({ createdAt: -1 });
  res.json(diets);
}));

// --- Admin APIs ---
app.get("/admin/analytics", auth, adminAuth, asyncHandler(async (req, res) => {
  const totalUsers = await User.countDocuments();
  const totalDiets = await Diet.countDocuments();
  const avgCalories = await Diet.aggregate([
    { $group: { _id: null, avg: { $avg: "$calories" } } }
  ]);

  res.json({
    totalUsers,
    totalDiets,
    avgCalories: avgCalories[0]?.avg || 0
  });
}));

app.get("/admin/users", auth, adminAuth, asyncHandler(async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
}));

// --- Centralized Error Handling ---
app.use((err, req, res, next) => {
  console.error("PRODUCTION ERROR:", err.stack);
  res.status(500).json({
    error: "A server error occurred. Please try again later.",
    message: process.env.NODE_ENV === "development" ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Secure Server running on port ${PORT}`));
