// ============================================
// api/generate.js - COMPLETE NON-STREAMING ENDPOINT
// Full featured with multiple provider support
// Uses gemini-2.5-flash as primary
// ============================================

export default async function handler(req, res) {
  // ============================================
  // CORS HEADERS
  // ============================================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Health check endpoint
  if (req.method === "GET") {
    return res.json({
      ok: true,
      endpoint: "generate",
      message: "Kids3D Teacher API - Generate Endpoint",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      providers: {
        gemini: !!process.env.GEMINI_API_KEY,
        openai: !!process.env.OPENAI_API_KEY,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Only allow POST for generation
  if (req.method !== "POST") {
    return res.status(405).json({ 
      ok: false, 
      error: "Method not allowed. Use POST." 
    });
  }

  // ============================================
  // EXTRACT PROMPT FROM REQUEST
  // ============================================
  const prompt = req.body?.prompt ?? req.body?.text ?? req.body?.message;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({
      ok: false,
      error: "Missing 'prompt' in request body.",
      usage: {
        method: "POST",
        body: { prompt: "Your message here" },
      },
    });
  }

  // Optional parameters
  const temperature = req.body?.temperature ?? 0.7;
  const maxTokens = req.body?.max_tokens ?? 900;

  console.log(`📥 Generate request: "${prompt.substring(0, 50)}..."`);

  // ============================================
  // GEMINI PROVIDER (PRIMARY)
  // ============================================
  if (process.env.GEMINI_API_KEY) {
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const GEMINI_BASE_URL = process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta";

    const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

    try {
      console.log(`🚀 Calling Gemini (${GEMINI_MODEL})...`);

      const requestBody = {
        contents: [
          {
            parts: [{ text: prompt }],
            role: "user",
          },
        ],
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: maxTokens,
          topP: 0.95,
          topK: 40,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_KEY,
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json().catch(() => null);

      // Log response for debugging
      console.log("📥 Gemini response status:", response.status);

      if (!response.ok) {
        console.error("❌ Gemini API error:", response.status, JSON.stringify(data, null, 2));
        return res.status(502).json({
          ok: false,
          error: "Gemini API error",
          status: response.status,
          details: data?.error?.message || data,
        });
      }

      // Extract text from response
      const reply = extractTextFromResponse(data);

      if (!reply) {
        console.error("❌ No text in Gemini response:", JSON.stringify(data, null, 2));
        return res.status(502).json({
          ok: false,
          error: "No text in Gemini response",
          raw: data,
        });
      }

      console.log(`✅ Gemini replied: "${reply.substring(0, 50)}..."`);
      return res.json({ ok: true, reply: String(reply) });

    } catch (err) {
      console.error("❌ Gemini fetch error:", err.message);
      // Fall through to OpenAI if available
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({
          ok: false,
          error: "Gemini request failed",
          details: err.message,
        });
      }
      console.log("⚠️ Falling back to OpenAI...");
    }
  }

  // ============================================
  // OPENAI PROVIDER (FALLBACK)
  // ============================================
  if (process.env.OPENAI_API_KEY) {
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-3.5-turbo";

    try {
      console.log(`🚀 Calling OpenAI (${OPENAI_MODEL})...`);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: temperature,
          max_tokens: maxTokens,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        console.error("❌ OpenAI API error:", response.status, data);
        return res.status(502).json({
          ok: false,
          error: "OpenAI API error",
          status: response.status,
          details: data?.error?.message || data,
        });
      }

      const reply = extractTextFromResponse(data);

      console.log(`✅ OpenAI replied: "${reply?.substring(0, 50)}..."`);
      return res.json({ ok: true, reply: String(reply || "No response") });

    } catch (err) {
      console.error("❌ OpenAI fetch error:", err.message);
      return res.status(500).json({
        ok: false,
        error: "OpenAI request failed",
        details: err.message,
      });
    }
  }

  // ============================================
  // NO PROVIDER CONFIGURED
  // ============================================
  return res.status(500).json({
    ok: false,
    error: "No LLM provider configured",
    hint: "Set GEMINI_API_KEY or OPENAI_API_KEY in environment variables",
  });
}

// ============================================
// HELPER: Extract text from various API formats
// ============================================
function extractTextFromResponse(obj) {
  if (!obj) return null;

  // Gemini format: candidates[0].content.parts[0].text
  try {
    const geminiText = obj?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (geminiText?.trim()) return geminiText.trim();
  } catch {}

  // Gemini alternate format: multiple parts
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

  // OpenAI format: choices[0].message.content
  try {
    const openaiText = obj?.choices?.[0]?.message?.content ?? obj?.choices?.[0]?.text;
    if (openaiText?.trim()) return openaiText.trim();
  } catch {}

  // Direct text field
  if (obj?.text?.trim()) return obj.text.trim();
  if (obj?.response?.text?.trim()) return obj.response.text.trim();
  if (obj?.content?.trim()) return obj.content.trim();

  // Outputs format
  try {
    const outputText = obj?.outputs?.[0]?.content?.[0]?.text;
    if (outputText?.trim()) return outputText.trim();
  } catch {}

  // Last resort: stringify
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}