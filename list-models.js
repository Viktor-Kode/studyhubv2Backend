import dotenv from 'dotenv';
dotenv.config();

async function checkModels() {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        console.error('DEEPSEEK_API_KEY is not configured.');
        process.exitCode = 1;
        return;
    }

    try {
        const response = await fetch('https://api.deepseek.com/models', {
            headers: { Authorization: `Bearer ${apiKey}` }
        });
        const data = await response.json();
        if (response.ok && data.data) {
            console.log("Available models:");
            data.data.forEach(m => console.log(`- ${m.id}`));
        } else {
            console.error("Could not list models:", data);
            process.exitCode = 1;
        }
    } catch (err) {
        console.error("Error fetching models:", err.message);
    }
}

checkModels();
