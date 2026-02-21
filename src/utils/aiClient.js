import { AI_PROVIDERS, getModelById, getProviderConfig } from "../config/aiConfig.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const aiClient = {
    /**
     * Unified chat completion that handles multiple providers (Gemini, Hugging Face)
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

        if (modelInfo.provider === "gemini") {
            return await handleGeminiRequest(modelId, messages, max_tokens, temperature, providerConfig);
        } else if (modelInfo.provider === "hf-inference") {
            return await handleHFRequest(modelId, messages, max_tokens, temperature, providerConfig);
        } else {
            throw new Error(`Provider ${modelInfo.provider} is not supported.`);
        }
    }
};

/**
 * Handle requests to Google Gemini
 */
async function handleGeminiRequest(modelId, messages, max_tokens, temperature, config, retryCount = 0) {
    console.log(`🚀 GEMINI API CALL: model=${modelId} (Attempt ${retryCount + 1})`);

    try {
        const genAI = new GoogleGenerativeAI(config.apiKey);

        // Extract system prompt if present
        const systemMessage = messages.find(m => m.role === 'system');
        const otherMessages = messages.filter(m => m.role !== 'system');

        // Configuration for Gemini
        const modelConfig = {
            model: modelId,
        };

        if (systemMessage) {
            modelConfig.systemInstruction = systemMessage.content;
        }

        const model = genAI.getGenerativeModel(modelConfig);

        // Convert messages to Gemini format
        // Gemini expects roles 'user' and 'model' (instead of assistant)
        const history = otherMessages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        const lastMessage = otherMessages[otherMessages.length - 1];

        const generationConfig = {
            maxOutputTokens: max_tokens || 2048,
            temperature: temperature || 0.7,
        };

        let response;
        // Use startChat for history or generateContent for single prompt
        if (history.length > 0) {
            const chat = model.startChat({ history, generationConfig });
            const result = await chat.sendMessage(lastMessage.content);
            response = await result.response;
        } else {
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: lastMessage.content }] }],
                generationConfig,
            });
            response = await result.response;
        }

        return {
            choices: [{
                message: {
                    content: response.text()
                }
            }]
        };
    } catch (err) {
        // Handle Rate Limit (429)
        if (err.message?.includes('429') && retryCount < 3) {
            const waitMs = 5000;
            console.warn(`⏳ Gemini Quota exceeded. Retrying in ${waitMs / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
            return await handleGeminiRequest(modelId, messages, max_tokens, temperature, config, retryCount + 1);
        }

        console.error("Gemini Request Error:", err.message);
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

export default aiClient;
