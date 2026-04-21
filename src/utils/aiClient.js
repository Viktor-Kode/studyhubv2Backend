import OpenAI from "openai";
import { AI_PROVIDERS, getModelById, getProviderConfig } from "../config/aiConfig.js";
import { getEnv } from "../config/env.js";


const aiClient = {
    /**
     * Unified chat completion that handles multiple providers (DeepSeek, Hugging Face)
     */
    chatCompletion: async (params) => {
        const { model: modelId, messages, max_tokens, temperature, stream = false } = params;
        const modelInfo = getModelById(modelId);

        if (!modelInfo) {
            throw new Error(`Model ${modelId} not found in registry.`);
        }

        const providerConfig = getProviderConfig(modelInfo.provider);

        if (!providerConfig.apiKey) {
            throw new Error(`AI Service Unavailable: API Key for ${modelInfo.provider} is not configured on the server.`);
        }

        if (modelInfo.provider === "deepseek") {
            return await handleDeepSeekRequest(modelId, messages, max_tokens, temperature, providerConfig, stream);
        } else if (modelInfo.provider === "hf-inference") {
            if (stream) throw new Error("Streaming not yet implemented for HF provider.");
            return await handleHFRequest(modelId, messages, max_tokens, temperature, providerConfig);
        } else {
            throw new Error(`Provider ${modelInfo.provider} is not supported.`);
        }
    },
    /**
     * Helper for quick text responses using a default model
     */
    generateChatResponse: async (messages) => {
        const response = await aiClient.chatCompletion({
            model: "deepseek-chat", // or any default
            messages
        });
        return response.choices[0].message.content;
    }
};

/**
 * Handle requests to DeepSeek AI (OpenAI Compatible)
 */
async function handleDeepSeekRequest(modelId, messages, max_tokens, temperature, config, stream = false) {
    console.log(`🚀 DEEPSEEK API CALL: model=${modelId} stream=${stream}`);

    try {
        const client = new OpenAI({
            baseURL: "https://api.deepseek.com",
            apiKey: config.apiKey,
        });

        if (stream) {
            return await client.chat.completions.create({
                model: modelId || "deepseek-chat",
                messages: messages,
                max_tokens: max_tokens || 2048,
                temperature: temperature || 0.7,
                stream: true,
            });
        }

        const response = await client.chat.completions.create({
            model: modelId || "deepseek-chat",
            messages: messages, // DeepSeek maintains history by passing full array
            max_tokens: max_tokens || 2048,
            temperature: temperature || 0.7,
            stream: false,
        });

        return {
            choices: [{
                message: {
                    content: response.choices[0].message.content
                }
            }]
        };
    } catch (err) {
        console.error("DeepSeek Request Error:", err.message);
        throw err;
    }
}

/**
 * Handle requests to Hugging Face Inference API (Serverless)
 */
async function handleHFRequest(model, messages, max_tokens, temperature, config) {
    const url = `https://api-inference.huggingface.co/models/${model}`;
    console.log(`📡 HF API CALL: model=${model}`);

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

/**
 * Simple callAI helper for teacher tools and other single-prompt flows
 */
export const callAI = async (prompt, maxTokens = 2000) => {
    const response = await aiClient.chatCompletion({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7,
    });
    return response.choices?.[0]?.message?.content || "";
};

export default aiClient;
