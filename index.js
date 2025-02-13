import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import Together from "together-ai";

// Needed for __dirname in ES Modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust the proxy for proper X-Forwarded-For handling
app.set("trust proxy", 1);

// Enable CORS for all requests
app.use(cors());

// Middleware to log all incoming requests with timestamp, method, URL, and IP address.
app.use((req, res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} from ${req.ip}`
  );
  next();
});

// Serve static files (for other potential assets)
app.use(express.static(path.join(__dirname, "public")));

app.use(express.json());

// Rate limiter: Allow only one image generation request per second per client IP.
const limiter = rateLimit({
  windowMs: 1000, // 1 second window
  max: 1, // start blocking after 1 request
  message: "Rate limit exceeded. Only one image per second allowed."
});

// Main endpoint: /generate-image
app.post("/generate-image", limiter, async (req, res) => {
  const prompt = req.body.prompt;
  console.log(
    `[${new Date().toISOString()}] Received /generate-image request from ${req.ip} with prompt: ${prompt}`
  );

  if (!prompt || typeof prompt !== "string") {
    console.warn(
      `[${new Date().toISOString()}] Invalid prompt received from ${req.ip}`
    );
    return res
      .status(400)
      .json({ error: "Missing or invalid 'prompt' in request body." });
  }

  // Step 1: Content Moderation using Together AI Chat Completions API
  try {
    console.log(
      `[${new Date().toISOString()}] Initiating content moderation for prompt: ${prompt}`
    );
    const moderator = new Together({ apiKey: process.env.TOGETHER_API_KEY });

    console.debug(
      `[${new Date().toISOString()}] Sending moderation request to Together API`
    );
    const modResponse = await moderator.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a content moderator for a text-to-image pipeline. Your job is to decide if the content is appropriate.\n\n**Answer with `yes` or `no` only.**"
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
    console.log(
      `[${new Date().toISOString()}] Content moderation result: ${moderationAnswer}`
    );

    if (moderationAnswer === "no") {
      console.warn(
        `[${new Date().toISOString()}] Content moderated as inappropriate. Returning nonono.gif to ${req.ip}`
      );
      try {
        // Read nonono.gif from filesystem and convert to base64
        const gifPath = path.join(__dirname, "public", "nonono.gif");
        const gifBuffer = await fs.readFile(gifPath);
        const base64Gif = gifBuffer.toString("base64");
        return res.json({ b64_json: base64Gif });
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] Failed to read nonono.gif:`,
          error
        );
        return res.status(500).json({ error: "Internal Server Error" });
      }
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error during content moderation for prompt: ${prompt}`,
      error
    );
    return res
      .status(500)
      .json({ error: "Content moderation failed. Please try again later." });
  }

  // Step 2: Image Generation using Together AI Images API via together-ai library
  try {
    console.log(
      `[${new Date().toISOString()}] Passed moderation. Generating image for prompt: ${prompt}`
    );

    if (!process.env.TOGETHER_API_KEY) {
      console.error(`[${new Date().toISOString()}] Missing Together API key.`);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Create an instance of Together with your API key.
    const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });

    // Use the together.images.create method to generate the image.
    const imageResponse = await together.images.create({
      model: "black-forest-labs/FLUX.1-schnell-Free",
      prompt: prompt,
      width: 1440,
      height: 768,
      steps: 4,
      n: 1,
      response_format: "b64_json"
    });

    console.log(
      `[${new Date().toISOString()}] Image generated successfully for prompt: ${prompt}`
    );
    // Return the base64 image string as part of the JSON response.
    return res.json({ b64_json: imageResponse.data[0].b64_json });
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error generating image for prompt: ${prompt}`,
      error
    );
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server listening on port ${PORT}`);
});