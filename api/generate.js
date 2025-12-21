// ============================================
// api/generate.js - OPTIMIZED FOR GEMINI 2.0 FLASH
// Better conversation quality + Complete responses
// ============================================

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.json({
      ok: true,
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash-exp",
      endpoint: "generate",
      status: "ready"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Use POST" });
  }

  // Extract params
  const prompt = req.body?.prompt;
  if (!prompt) {
    return res.status(400).json({ ok: false, error: "Missing prompt" });
  }

  const temperature = req.body?.temperature ?? 0.85;
  const maxTokens = req.body?.max_tokens ?? 400;

  console.log(`📥 Request: ${prompt.substring(0, 50)}...`);
  console.log(`⚙️ temp=${temperature}, max=${maxTokens}`);

  // API Key
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  // USE GEMINI 2.0 FLASH - MUCH BETTER!
  const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";

  if (!GEMINI_KEY) {
    console.error("❌ No GEMINI_API_KEY");
    return res.status(500).json({ ok: false, error: "API key missing" });
  }

  // API Call
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

  try {
    console.log(`🚀 Calling ${GEMINI_MODEL}...`);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
          role: "user"
        }],
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
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ API error ${response.status}:`, error);
      return res.status(response.status).json({
        ok: false,
        error: `Gemini error: ${response.status}`
      });
    }

    const data = await response.json();
    const candidates = data?.candidates;

    if (!candidates || candidates.length === 0) {
      console.error("❌ No candidates");
      return res.status(500).json({ ok: false, error: "No response" });
    }

    const reply = candidates[0]?.content?.parts?.[0]?.text || "";
    const finishReason = candidates[0]?.finishReason;

    if (!reply || reply.trim().length === 0) {
      console.error("❌ Empty reply");
      return res.status(500).json({ ok: false, error: "Empty response" });
    }

    // Check if blocked
    if (finishReason === "SAFETY") {
      console.warn("⚠️ Safety block");
      return res.status(400).json({
        ok: false,
        error: "Response blocked by safety filters"
      });
    }

    // Validate response length
    const wordCount = reply.trim().split(/\s+/).length;
    console.log(`✅ Response: ${wordCount} words`);
    console.log(`📝 "${reply.substring(0, 80)}..."`);

    if (wordCount < 20) {
      console.warn(`⚠️ SHORT: ${wordCount} words - retrying might help`);
    }

    return res.json({
      ok: true,
      reply: reply.trim(),
      metadata: {
        model: GEMINI_MODEL,
        wordCount: wordCount,
        finishReason: finishReason,
        tokensUsed: data.usageMetadata?.totalTokenCount || 0
      }
    });

  } catch (error) {
    console.error("❌ Handler error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Internal error",
      message: error.message
    });
  }
}