import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import Together from "together-ai";

// Needed for __dirname in ES Modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Enable CORS for all requests
app.use(cors());

// Middleware to log all incoming requests with timestamp, method, URL, and IP address.
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});

// Serve static files (for the nonono.gif)
app.use(express.static(path.join(__dirname, "public")));

app.use(express.json());

// Rate limiter: Allow only one image generation request per second per client IP.
const limiter = rateLimit({
  windowMs: 1000, // 1 second window
  max: 1,         // start blocking after 1 request
  message: "Rate limit exceeded. Only one image per second allowed."
});

// Main endpoint: /generate-image
app.post("/generate-image", limiter, async (req, res) => {
  const prompt = req.body.prompt;
  console.log(`[${new Date().toISOString()}] Received /generate-image request from ${req.ip} with prompt: ${prompt}`);

  if (!prompt || typeof prompt !== "string") {
    console.warn(`[${new Date().toISOString()}] Invalid prompt received from ${req.ip}`);
    return res
      .status(400)
      .json({ error: "Missing or invalid 'prompt' in request body." });
  }

  // Step 1: Content Moderation using Together chat completions API
  try {
    console.log(`[${new Date().toISOString()}] Initiating content moderation for prompt: ${prompt}`);
    const moderator = new Together();

    console.debug(`[${new Date().toISOString()}] Sending chat moderation request to Together API`);
    const modResponse = await moderator.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a content moderator for a text-to-image pipeline. Your job is to decide if the content is appropriate.\n\n**You answer with `yes` or `no` only.**"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
      max_tokens: 10,
      temperature: 0.7,
      top_p: 0.7,
      top_k: 50,
      repetition_penalty: 1,
      stop: ["<|eot_id|>", "<|eom_id|>"],
      stream: false
    });

    // Determine the moderator's answer.
    let moderationAnswer = "";
    if (modResponse.result) {
      moderationAnswer = modResponse.result.trim().toLowerCase();
    } else if (modResponse.choices && Array.isArray(modResponse.choices)) {
      moderationAnswer = modResponse.choices[0].message.content.trim().toLowerCase();
    } else {
      throw new Error("Unexpected format from moderation response.");
    }
    console.log(`[${new Date().toISOString()}] Content moderation result: ${moderationAnswer}`);

    if (moderationAnswer === "no") {
      console.warn(`[${new Date().toISOString()}] Content moderated as inappropriate. Returning local nonono.gif to ${req.ip}`);
      return res.json({ url: "/nonono.gif" });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error during content moderation for prompt: ${prompt}`, error);
    return res
      .status(500)
      .json({ error: "Content moderation failed. Please try again later." });
  }

  // Step 2: Image Generation using Together Image API
  try {
    console.log(`[${new Date().toISOString()}] Passed moderation. Generating image for prompt: ${prompt}`);
    const togetherResponse = await fetch("https://api.together.xyz/v1/images", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.TOGETHER_API_KEY}`
      },
      body: JSON.stringify({
        model: "black-forest-labs/FLUX.1-schnell-Free",
        prompt: prompt,
        width: 1024,
        height: 768,
        steps: 1,
        n: 1,
        response_format: "url"
      })
    });

    const data = await togetherResponse.json();
    console.debug(`[${new Date().toISOString()}] Together Image API responded with status: ${togetherResponse.status}, data:`, data);
    
    if (!togetherResponse.ok) {
      const errorMessage = data.error || "Error generating image.";
      console.error(`[${new Date().toISOString()}] Image generation failed with status ${togetherResponse.status}: ${errorMessage}`);
      return res.status(togetherResponse.status).json({ error: errorMessage });
    }

    console.log(`[${new Date().toISOString()}] Image generated successfully for prompt: ${prompt}, URL: ${data.data[0].url}`);
    return res.json({ url: data.data[0].url });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error generating image for prompt: ${prompt}`, error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server listening on port ${PORT}`);
});