import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Kids3D Teacher backend is running",
    providers: {
      gemini: !!process.env.GEMINI_API_KEY
    }
  });
});

app.post("/api/generate", async (req, res) => {
  const { prompt } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response";

    res.json({ ok: true, reply });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default app;