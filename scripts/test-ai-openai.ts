
/**
 * OpenAI 接口测试脚本
 * 功能：
 * 1. 实例化 OpenAIProvider。
 * 2. 测试 generateSimilarQuestion (生成相似题) 功能。
 * 3. 测试 analyzeImage (图片分析) 功能。
 * 运行：npx tsx --conditions=react-server scripts/test-ai-openai.ts（提供商模块带 server-only 保护，需以 react-server 条件解析）
 * 用途：用于验证 OpenAI (或兼容接口) 配置是否正确以及核心功能是否可用。
 */
import { OpenAIProvider } from "../src/lib/ai/openai-provider";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load environment variables from .env file in root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function testOpenAI() {
    console.log("Testing OpenAI Connection...");
    console.log("API Key present:", !!process.env.OPENAI_API_KEY);
    console.log("Base URL:", process.env.OPENAI_BASE_URL);
    console.log("Model:", process.env.OPENAI_MODEL);

    if (!process.env.OPENAI_API_KEY) {
        console.error("Error: OPENAI_API_KEY is missing in .env");
        return;
    }

    // Explicitly use glm-4-flash if not set in env, or respect env
    const model = process.env.OPENAI_MODEL || "glm-4-flash";
    const provider = new OpenAIProvider({
        model: model
    });

    // Test 1: Generate Similar Question
    try {
        console.log("\n--- Test 1: generateSimilarQuestion ---");
        console.log("Sending request...");
        const result = await provider.generateSimilarQuestion(
            "已知 $x + y = 5$，求 $2x + 2y$ 的值。",
            ["代数", "因式分解"],
            "zh",
            "medium"
        );
        console.log("Success! Response:");
        console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
        console.error("Test 1 Failed:", error.message);
        if (error.cause) console.error("Cause:", error.cause);
    }

    // Test 2: Analyze Image
    try {
        console.log("\n--- Test 2: analyzeImage ---");

        // Try to find a real image in the artifacts directory
        const artifactDir = "/home/wttwins/.gemini/antigravity/brain/7857ca65-80c3-41fe-a5d2-21f3802af3f8";
        const imageFile = "eng.jpg";
        const realImagePath = path.join(artifactDir, imageFile);

        let base64Image = "";

        if (fs.existsSync(realImagePath)) {
            console.log(`Found real test image: ${imageFile}`);
            const imageBuffer = fs.readFileSync(realImagePath);
            base64Image = imageBuffer.toString("base64");
        } else {
            console.log("No real test image found, using dummy 1x1 pixel image...");
            // Creating a minimal 1x1 white pixel PNG base64
            base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        }

        console.log("Sending request...");
        const result = await provider.analyzeImage(base64Image, "image/png", "zh");
        console.log("Success! Response:");
        console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
        console.error("Test 2 Failed:", error.message);
        if (error.cause) console.error("Cause:", error.cause);
    }
}

testOpenAI();
