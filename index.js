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
  if (!prompt || typeof prompt !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid 'prompt' in request body." });
  }

  try {
    // Initialize Together instance for the moderator.
    const moderator = new Together();

    // Call the Together chat completions API in non-streaming mode for simplicity.
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
      // If the Together client returns a simple "result" field.
      moderationAnswer = modResponse.result.trim().toLowerCase();
    } else if (modResponse.choices && Array.isArray(modResponse.choices)) {
      // Or if it returns a choices array.
      moderationAnswer = modResponse.choices[0].message.content.trim().toLowerCase();
    } else {
      throw new Error("Unexpected format from moderation response.");
    }

    console.log("Content moderation result:", moderationAnswer);

    if (moderationAnswer === "no") {
      // If the content is not appropriate, respond with the local image.
      // Assuming "nonono.gif" is served from the public folder.
      return res.json({ url: "/nonono.gif" });
    }
  } catch (error) {
    console.error("Error during content moderation:", error);
    return res
      .status(500)
      .json({ error: "Content moderation failed. Please try again later." });
  }

  // Proceed with image generation if moderation passes.
  try {
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
    if (!togetherResponse.ok) {
      const errorMessage = data.error || "Error generating image.";
      return res.status(togetherResponse.status).json({ error: errorMessage });
    }

    // Return the generated image URL.
    return res.json({ url: data.data[0].url });
  } catch (error) {
    console.error("Error generating image:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});