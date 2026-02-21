import dotenv from 'dotenv';
dotenv.config();

async function checkModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.models) {
            console.log("Available models:");
            data.models.forEach(m => console.log(`- ${m.name}`));
        } else {
            console.log("No models found:", data);
        }
    } catch (err) {
        console.error("Error fetching models:", err.message);
    }
}

checkModels();
