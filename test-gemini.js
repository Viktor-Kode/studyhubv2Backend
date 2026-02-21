import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // There isn't a direct listModels in the standard SDK easily accessible without extra auth usually
        // but we can try a simple request to confirm model existence
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("test");
        console.log("Success with gemini-1.5-flash");
    } catch (err) {
        console.error("Error with gemini-1.5-flash:", err.message);

        try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
            await model.generateContent("test");
            console.log("Success with gemini-1.5-flash-latest");
        } catch (err2) {
            console.error("Error with gemini-1.5-flash-latest:", err2.message);
        }
    }
}

listModels();
