require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Diet = require("./models/Diet");

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("DB connected"))
  .catch(err => console.log(err));

const API_KEY = process.env.OPENAI_API_KEY;

// Authentication Middleware
function auth(req, res, next) {
  const token = req.headers.authorization;

  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// Admin Middleware
async function adminAuth(req, res, next) {
  const user = await User.findById(req.userId);

  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Not admin" });
  }

  next();
}

// --- Auth Routes ---

app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    
    // Automatically set as admin for sambhavi2908@gmail.com
    const role = email === "sambhavi2908@gmail.com" ? "admin" : "user";
    
    const user = await User.create({ email, password: hashed, role });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

    res.json({ token, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Protected Routes ---

function detectPattern(diet) {
  if (diet.calories < 1200) {
    return "Warning: Too low calorie intake detected.";
  }
  return null;
}

app.post("/diet", auth, async (req, res) => {
  const { phase, calories, likes, dislikes } = req.body;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `Create a ${calories} kcal diet plan for ${phase}. Likes: ${likes}. Avoid: ${dislikes}`
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const plan = response.data.choices[0].message.content;

    const insight = detectPattern({ calories });

    await Diet.create({
      userId: req.userId,
      phase,
      calories,
      plan,
    });

    res.json({ plan, insight });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/chat", auth, async (req, res) => {
  const { message } = req.body;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a health assistant." },
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/history", auth, async (req, res) => {
  const diets = await Diet.find({ userId: req.userId });
  res.json(diets);
});

// --- Admin APIs ---

app.get("/admin/users", auth, adminAuth, async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

app.get("/admin/diets", auth, adminAuth, async (req, res) => {
  const diets = await Diet.find();
  res.json(diets);
});

app.get("/admin/analytics", auth, adminAuth, async (req, res) => {
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
});

app.get("/admin/phases", auth, adminAuth, async (req, res) => {
  const data = await Diet.aggregate([
    { $group: { _id: "$phase", count: { $sum: 1 } } }
  ]);

  res.json(data);
});

app.get("/admin/export", auth, adminAuth, async (req, res) => {
  const data = await Diet.find();
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
