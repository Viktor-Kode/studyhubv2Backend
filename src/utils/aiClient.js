import { AI_PROVIDERS, getModelById, getProviderConfig } from "../config/aiConfig.js";

const aiClient = {
    /**
     * Unified chat completion that handles multiple providers (Groq, Hugging Face)
     */
    chatCompletion: async (params) => {
        const { model: modelId, messages, max_tokens, temperature } = params;
        const modelInfo = getModelById(modelId);

        if (!modelInfo) {
            throw new Error(`Model ${modelId} not found in registry.`);
        }

        const providerConfig = getProviderConfig(modelInfo.provider);

        if (!providerConfig.apiKey) {
            throw new Error(`API Key for ${modelInfo.provider} not configured.`);
        }

        if (modelInfo.provider === "groq") {
            return await handleGroqRequest(modelId, messages, max_tokens, temperature, providerConfig);
        } else if (modelInfo.provider === "hf-inference") {
            return await handleHFRequest(modelId, messages, max_tokens, temperature, providerConfig);
        } else {
            throw new Error(`Provider ${modelInfo.provider} is not supported.`);
        }
    }
};

/**
 * Utility to wait for a specific duration
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Handle requests to Groq Cloud (OpenAI compatible)
 * Includes automatic chunking and Rate Limit (429) handling for Free Tier
 */
async function handleGroqRequest(model, messages, max_tokens, temperature, config) {
    const url = `${config.baseUrl}/chat/completions`;
    const TOKEN_LIMIT = 3000; // Requested chunk size
    const CHAR_LIMIT = TOKEN_LIMIT * 3.5; // Estimated character equivalent

    // Helper for making requests with retries on rate limit (429)
    const fetchWithRetry = async (payload, retryCount = 0) => {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (response.status === 429) {
            const result = await response.json();
            const waitTimeStr = result.error?.message?.match(/try again in ([\d.]+)(m?s)/);
            let waitMs = 5000; // Default 5s

            if (waitTimeStr) {
                const value = parseFloat(waitTimeStr[1]);
                const unit = waitTimeStr[2];
                waitMs = unit === 'ms' ? value : value * 1000;
            }

            console.warn(`⏳ Rate limit reached. Retrying in ${waitMs / 1000}s... (Attempt ${retryCount + 1})`);
            await sleep(waitMs + 500); // Add small buffer
            return await fetchWithRetry(payload, retryCount + 1);
        }

        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error?.message || `Groq API Error: ${response.status}`);
        }

        return await response.json();
    };

    // Find the largest message content (usually the document)
    const lastUserMessageIndex = messages.findLastIndex(m => m.role === 'user');
    const content = lastUserMessageIndex !== -1 ? messages[lastUserMessageIndex].content : "";

    if (content.length > CHAR_LIMIT) {
        console.log(`⚠️ Content too large (${content.length} chars). Partitioning into chunks...`);

        // Split text into chunks
        const chunks = [];
        for (let i = 0; i < content.length; i += CHAR_LIMIT) {
            chunks.push(content.substring(i, i + CHAR_LIMIT));
        }

        let combinedJson = [];
        let combinedText = "";
        let isJsonResponse = false;

        for (let i = 0; i < chunks.length; i++) {
            console.log(`📦 Processing chunk ${i + 1}/${chunks.length}...`);

            // Reconstruct messages with current chunk
            const chunkMessages = [...messages];
            chunkMessages[lastUserMessageIndex] = {
                ...messages[lastUserMessageIndex],
                content: chunks[i]
            };

            const result = await fetchWithRetry({
                model,
                messages: chunkMessages,
                max_tokens: max_tokens || 1000,
                temperature: temperature || 0.7,
            });

            const chunkOutput = result.choices[0].message.content;

            // Try to extract JSON array if present
            const startIdx = chunkOutput.indexOf('[');
            const endIdx = chunkOutput.lastIndexOf(']');

            if (startIdx !== -1 && endIdx !== -1) {
                const jsonStr = chunkOutput.substring(startIdx, endIdx + 1);
                try {
                    const parsed = JSON.parse(jsonStr);
                    if (Array.isArray(parsed)) {
                        isJsonResponse = true;
                        combinedJson = combinedJson.concat(parsed);
                    } else {
                        combinedText += chunkOutput + "\n\n";
                    }
                } catch (e) {
                    combinedText += chunkOutput + "\n\n";
                }
            } else {
                combinedText += chunkOutput + "\n\n";
            }
        }

        return {
            choices: [{
                message: {
                    content: isJsonResponse ? JSON.stringify(combinedJson) : combinedText.trim()
                }
            }]
        };
    }

    console.log(`🚀 GROQ API CALL: model=${model}`);
    try {
        const result = await fetchWithRetry({
            model,
            messages,
            max_tokens: max_tokens || 1000,
            temperature: temperature || 0.7,
        });
        return result;
    } catch (err) {
        console.error("Groq Request Error:", err.message);
        throw err;
    }
}

/**
 * Handle requests to Hugging Face Inference API (Serverless)
 */
async function handleHFRequest(model, messages, max_tokens, temperature, config) {
    const url = `https://api-inference.huggingface.co/models/${model}`;
    console.log(`📡 HF API CALL: model=${model}`);

    // HF Inference API often expects a simple string "inputs" or special prompt format
    const prompt = messages
        .map(m => `${m.role === 'system' ? 'Instruction' : m.role === 'user' ? 'Input' : 'Response'}: ${m.content}`)
        .join('\n\n') + '\n\nResponse:';

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                inputs: prompt,
                parameters: {
                    max_new_tokens: max_tokens || 1000,
                    temperature: temperature || 0.7,
                }
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            if (response.status === 503) {
                throw new Error('Hugging Face model is warming up. Try again in a bit.');
            }
            throw new Error(result.error || `HF API Error: ${response.status}`);
        }

        const generatedContent = Array.isArray(result) ? result[0].generated_text : result.generated_text;

        return {
            choices: [{
                message: {
                    content: generatedContent || "No response generated."
                }
            }]
        };
    } catch (err) {
        console.error("HF Request Error:", err.message);
        throw err;
    }
}

export default aiClient;
