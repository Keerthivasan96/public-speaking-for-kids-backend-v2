/**
 * server.js - FIXED VERSION
 * Express backend for Kids3D Teacher
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);

// ✅ CORS Configuration
app.use(
  cors({
    origin: [
      "https://public-speaking-for-kids2.vercel.app",
      "http://localhost:5173",
      "http://localhost:3000"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ Health Check Route
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Kids3D Teacher backend is running",
    providers: {
      gemini: !!process.env.GEMINI_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
  });
});

/**
 * ✅ Extract text from various API response formats
 */
function extractTextFromResponse(obj) {
  if (!obj) return null;

  try {
    const cand = obj?.candidates?.[0];
    const partText = cand?.content?.parts?.[0]?.text;
    if (partText?.trim()) return partText.trim();
  } catch {}

  try {
    const c2 = obj?.outputs?.[0]?.content?.[0]?.text;
    if (c2?.trim()) return c2.trim();
  } catch {}

  if (obj?.text?.trim()) return obj.text.trim();
  if (obj?.response?.text?.trim()) return obj.response.text.trim();

  try {
    const openaiMsg =
      obj?.choices?.[0]?.message?.content ?? obj?.choices?.[0]?.text;
    if (openaiMsg?.trim()) return openaiMsg.trim();
  } catch {}

  try {
    const parts = obj?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts) && parts.length) {
      const joined = parts
        .map((p) => p?.text || "")
        .filter(Boolean)
        .join("\n\n");
      if (joined.trim()) return joined.trim();
    }
  } catch {}

  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

/**
 * ✅ SHARED HANDLER for both /api/chat and /api/generate
 */
async function handleChatRequest(req, res) {
  const prompt = req.body?.prompt ?? req.body?.text;
  
  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ ok: false, error: "Missing 'prompt' in request body." });
  }

  // ✅ Gemini Provider
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const baseUrl =
      process.env.GEMINI_API_URL ||
      "https://generativelanguage.googleapis.com/v1beta";
    const endpoint = `${baseUrl}/models/${encodeURIComponent(
      model
    )}:generateContent`;

    try {
      const body = {
        contents: [
          {
            parts: [{ text: prompt }],
            role: "user",
          },
        ],
      };

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok) {
        console.error("Gemini API error", resp.status, json);
        return res.status(502).json({
          ok: false,
          error: "Gemini API error",
          status: resp.status,
          body: json,
        });
      }

      const reply = extractTextFromResponse(json);
      return res.json({ ok: true, reply: String(reply) });
      
    } catch (err) {
      console.error("Error calling Gemini:", err);
      return res.status(500).json({
        ok: false,
        error: "Server error calling Gemini",
        details: String(err),
      });
    }
  }

  // ✅ OpenAI Provider (fallback)
  if (process.env.OPENAI_API_KEY) {
    try {
      const model = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
      const resp = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 800,
          }),
        }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("OpenAI API error:", resp.status, text);
        return res.status(502).json({
          ok: false,
          error: "OpenAI API returned an error",
          status: resp.status,
          body: text,
        });
      }

      const data = await resp.json();
      const reply = extractTextFromResponse(data);

      return res.json({ ok: true, reply: String(reply) });
      
    } catch (err) {
      console.error("Error calling OpenAI:", err);
      return res.status(500).json({
        ok: false,
        error: "Server error calling OpenAI",
        details: String(err),
      });
    }
  }

  return res.status(500).json({
    ok: false,
    error:
      "No LLM provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY in .env",
  });
}

// ✅ ROUTE 1: /api/chat (original)
app.post("/api/chat", handleChatRequest);

// ✅ ROUTE 2: /api/generate (for frontend compatibility)
app.post("/api/generate", handleChatRequest);

// ✅ TTS Endpoint (stub)
app.post("/api/tts", async (req, res) => {
  const text = req.body?.text;
  if (!text) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing 'text' in request body." });
  }

  if (!process.env.TTS_PROVIDER) {
    return res.status(501).json({
      ok: false,
      error: "TTS provider not configured on backend.",
      suggestion:
        "Use frontend speechSynthesis.speak() for MVP, or set TTS_PROVIDER.",
    });
  }

  return res.status(501).json({ 
    ok: false, 
    error: "TTS not implemented yet." 
  });
});

// ✅ Static audio files (if needed)
app.use("/audio", express.static(path.join(process.cwd(), "audio")));

// Keep this for Vercel:
export default app;