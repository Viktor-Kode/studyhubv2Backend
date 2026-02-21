// AI Provider Configuration
export const AI_PROVIDERS = {
    "hf-inference": {
        name: "Hugging Face Inference API (Free Tier)",
        apiKey: process.env.HF_TOKEN,
        defaultProviderValue: "hf-inference",
    },
    "gemini": {
        name: "Google Gemini (Flash 1.5 - High Limit)",
        apiKey: process.env.GEMINI_API_KEY,
        defaultProviderValue: "gemini"
    }
};

export const MODEL_REGISTRY = [
    {
        id: "gemini-1.5-flash",
        name: "Gemini 1.5 Flash (Fast & Stable)",
        provider: "gemini",
        recommended: true,
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
