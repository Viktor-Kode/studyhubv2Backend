// AI Provider Configuration
export const AI_PROVIDERS = {
    "hf-inference": {
        name: "Hugging Face Inference API (Free Tier)",
        apiKey: process.env.HF_TOKEN,
        defaultProviderValue: "hf-inference",
    },
    "groq": {
        name: "Groq (Fast & High Quality)",
        apiKey: process.env.GROQ_API_KEY,
        baseUrl: "https://api.groq.com/openai/v1",
        defaultProviderValue: "groq"
    }
};

export const MODEL_REGISTRY = [
    {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B (Groq - Ultra Fast)",
        provider: "groq",
        recommended: false,
        task: "chat-completion"
    },
    {
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B (Groq - Instant)",
        provider: "groq",
        recommended: true,
        task: "chat-completion"
    },
    {
        id: "gemma2-9b-it",
        name: "Gemma 2 9B (Groq)",
        provider: "groq",
        recommended: false,
        task: "chat-completion"
    },
    {
        id: "mistralai/Mistral-7B-Instruct-v0.3",
        name: "Mistral 7B (HF Free)",
        provider: "hf-inference",
        recommended: false,
        task: "text-generation"
    }
];

export const getProviderConfig = (providerName) => {
    const config = AI_PROVIDERS[providerName];
    if (!config) {
        throw new Error(`Provider ${providerName} not found in configuration.`);
    }
    return config;
};

export const getModelById = (modelId) => {
    return MODEL_REGISTRY.find(m => m.id === modelId);
};
