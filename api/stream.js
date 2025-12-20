// ============================================
// api/stream.js - COMPLETE STREAMING ENDPOINT
// Full featured SSE streaming with Gemini
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
      endpoint: "stream",
      message: "Kids3D Teacher API - Streaming Endpoint",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      providers: {
        gemini: !!process.env.GEMINI_API_KEY,
        openai: !!process.env.OPENAI_API_KEY,
      },
      streaming: true,
      timestamp: new Date().toISOString(),
    });
  }

  // Only allow POST for streaming
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST.",
    });
  }

  // ============================================
  // EXTRACT PARAMETERS FROM REQUEST
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

  // Optional parameters with defaults
  const temperature = req.body?.temperature ?? 0.7;
  const maxTokens = req.body?.max_tokens ?? 900;

  console.log(`📥 Stream request: "${prompt.substring(0, 50)}..."`);

  // ============================================
  // CHECK API KEY
  // ============================================
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!GEMINI_KEY) {
    console.error("❌ GEMINI_API_KEY not configured");
    return res.status(500).json({
      ok: false,
      error: "GEMINI_API_KEY not configured",
      hint: "Set GEMINI_API_KEY in Vercel environment variables",
    });
  }

  // ============================================
  // SET SSE HEADERS FOR STREAMING
  // ============================================
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  
  // Flush headers immediately
  res.flushHeaders?.();

  // ============================================
  // GEMINI STREAMING API CALL
  // ============================================
  const GEMINI_BASE_URL = process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta";
  const streamUrl = `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;

  try {
    console.log(`🚀 Starting stream with ${GEMINI_MODEL}...`);

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

    const geminiResponse = await fetch(streamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    // ============================================
    // HANDLE API ERRORS
    // ============================================
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text().catch(() => "Unknown error");
      console.error("❌ Gemini stream error:", geminiResponse.status, errorText);

      // Send error as SSE event
      sendSSE(res, { error: `Gemini API error: ${geminiResponse.status}` });
      sendSSE(res, "[DONE]");
      return res.end();
    }

    // ============================================
    // PROCESS THE STREAM
    // ============================================
    const reader = geminiResponse.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let totalTokens = 0;

    console.log("📡 Stream connected, processing...");

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log(`✅ Stream complete. Total tokens: ${totalTokens}`);
        break;
      }

      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines
        if (!trimmedLine) continue;

        // Process SSE data lines
        if (trimmedLine.startsWith("data: ")) {
          const jsonStr = trimmedLine.slice(6).trim();

          // Skip empty data
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr);

            // Extract token from Gemini response structure
            const candidates = parsed?.candidates;

            if (candidates && candidates[0]) {
              const content = candidates[0].content;
              const parts = content?.parts;

              if (parts && parts[0]) {
                const token = parts[0].text || "";

                if (token) {
                  // Send token to client
                  sendSSE(res, { token });
                  totalTokens++;

                  // Log progress (first few tokens)
                  if (totalTokens <= 3) {
                    console.log(`📝 Token ${totalTokens}: "${token.substring(0, 20)}..."`);
                  }
                }
              }

              // Check if generation is complete
              const finishReason = candidates[0].finishReason;
              if (finishReason === "STOP" || finishReason === "MAX_TOKENS") {
                console.log(`🏁 Finish reason: ${finishReason}`);
                sendSSE(res, "[DONE]");
              }

              // Check for safety block
              if (finishReason === "SAFETY") {
                console.warn("⚠️ Response blocked by safety filters");
                sendSSE(res, { 
                  error: "Response blocked by safety filters",
                  finishReason: "SAFETY"
                });
                sendSSE(res, "[DONE]");
              }
            }

            // Handle error in response
            if (parsed?.error) {
              console.error("❌ Gemini error in stream:", parsed.error);
              sendSSE(res, { error: parsed.error.message || "Gemini error" });
              sendSSE(res, "[DONE]");
            }

          } catch (parseError) {
            // JSON parse error - skip this chunk
            // This is normal for incomplete chunks
            console.log("⚠️ Parse skip:", jsonStr.substring(0, 50));
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        if (buffer.startsWith("data: ")) {
          const jsonStr = buffer.slice(6).trim();
          const parsed = JSON.parse(jsonStr);
          const token = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (token) {
            sendSSE(res, { token });
          }
        }
      } catch (e) {
        // Ignore final buffer parse errors
      }
    }

    // Send final DONE signal
    sendSSE(res, "[DONE]");
    console.log("✅ Stream finished successfully");

  } catch (error) {
    console.error("❌ Stream handler error:", error.message);
    console.error(error.stack);

    // Send error to client
    sendSSE(res, { error: error.message });
    sendSSE(res, "[DONE]");

  } finally {
    // Ensure response is ended
    if (!res.writableEnded) {
      res.end();
    }
  }
}

// ============================================
// HELPER: Send SSE event
// ============================================
function sendSSE(res, data) {
  try {
    if (res.writableEnded) return;

    if (data === "[DONE]") {
      res.write("data: [DONE]\n\n");
    } else if (typeof data === "object") {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } else {
      res.write(`data: ${data}\n\n`);
    }
  } catch (e) {
    console.error("SSE write error:", e.message);
  }
}