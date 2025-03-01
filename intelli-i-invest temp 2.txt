const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const readline = require("readline");

const app = express();
app.use(bodyParser.json());

const ALPHA_VANTAGE_API_KEY = "GINJRH2433MOIVNU";
const GROQ_API_KEY = "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";

let cachedNews = {}; // Cache stock news for stability

// Delay function
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to extract company name and symbol from input
function parseCompanyInput(input) {
    const match = input.match(/(.+?)\s*\(([^)]+)\)$/);
    if (match) {
        return { companyName: match[1].trim(), stockSymbol: match[2].trim() };
    }
    return { companyName: input.trim(), stockSymbol: null };
}

// Function to fetch stock symbol from a stock name (if not provided)
async function fetchStockSymbol(stockName) {
    try {
        const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${stockName}&apikey=${ALPHA_VANTAGE_API_KEY}`;
        const response = await axios.get(url);

        if (response.data?.bestMatches?.length > 0) {
            return response.data.bestMatches[0]["1. symbol"];
        }
        return null;
    } catch (error) {
        console.error("Error fetching stock symbol:", error);
        return null;
    }
}

// Function to fetch stock-related news headlines (cached for 1 hour)
async function fetchStockNews(stockSymbol, count = 50) {
    const currentTime = Date.now();
    if (cachedNews[stockSymbol] && currentTime - cachedNews[stockSymbol].timestamp < 3600000) {
        return cachedNews[stockSymbol].news;
    }

    try {
        const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${stockSymbol}&apikey=${ALPHA_VANTAGE_API_KEY}`;
        const response = await axios.get(url);

        if (response.data?.feed) {
            const newsTitles = response.data.feed.slice(0, count).map(news => news.title);
            cachedNews[stockSymbol] = { news: newsTitles, timestamp: currentTime };
            return newsTitles;
        }
        return [];
    } catch (error) {
        console.error("Error fetching stock news:", error);
        return [];
    }
}

// Function to analyze sentiment using Groq API (Llama 3) with lower temperature
async function analyzeSentiment(newsHeadline) {
    try {
        const prompt = `Analyze the sentiment of this stock-related news headline: "${newsHeadline}". Reply with only 'positive', 'negative', or 'neutral'.`;
        await delay(100); // Introduce a small delay to stabilize responses

        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama3-8b-8192",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 10,
                temperature: 0.1, // Lower temperature for consistency
            },
            {
                headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
            }
        );

        return response.data.choices[0].message.content.trim().toLowerCase();
    } catch (error) {
        console.error("Error analyzing sentiment:", error);
        return "neutral";
    }
}

// Function to analyze sentiment multiple times and return the most common response
async function analyzeSentimentMultipleTimes(newsHeadline, attempts = 3) {
    let results = [];

    for (let i = 0; i < attempts; i++) {
        const sentiment = await analyzeSentiment(newsHeadline);
        results.push(sentiment);
    }

    return results.sort((a, b) =>
        results.filter(v => v === a).length - results.filter(v => v === b).length
    ).pop(); // Return the most frequently occurring sentiment
}

// Function to predict stock movement based on news sentiment
async function predictStockMovement(input, count = 50) {
    let { companyName, stockSymbol } = parseCompanyInput(input);

    if (!stockSymbol) {
        stockSymbol = await fetchStockSymbol(companyName);
        if (!stockSymbol) {
            return `Could not find stock symbol for "${companyName}".`;
        }
    }

    const newsHeadlines = await fetchStockNews(stockSymbol, count);
    if (newsHeadlines.length === 0) {
        return `Not enough news data to analyze for ${companyName} (${stockSymbol}).`;
    }

    const sentimentResults = await Promise.all(newsHeadlines.map(headline => analyzeSentimentMultipleTimes(headline, 3)));
    let sentimentCounts = { positive: 0, negative: 0, neutral: 0 };

    sentimentResults.forEach(sentiment => {
        if (sentimentCounts[sentiment] !== undefined) {
            sentimentCounts[sentiment]++;
        }
    });

    const total = sentimentCounts.positive + sentimentCounts.negative + sentimentCounts.neutral;
    if (total === 0) return `Not enough sentiment data for ${companyName} (${stockSymbol}).`;

    const posRatio = sentimentCounts.positive / total;
    const negRatio = sentimentCounts.negative / total;

    return posRatio > negRatio
        ? `Stock ${companyName} (${stockSymbol}) is likely to **increase** 📈 (Positive: ${(posRatio * 100).toFixed(2)}%, Negative: ${(negRatio * 100).toFixed(2)}%)`
        : `Stock ${companyName} (${stockSymbol}) is likely to **plummet** 📉 (Positive: ${(posRatio * 100).toFixed(2)}%, Negative: ${(negRatio * 100).toFixed(2)}%)`;
}

// API Endpoint for fetching and analyzing stock news
app.get("/predictStock", async (req, res) => {
    const stockInput = req.query.stock;
    if (!stockInput) {
        return res.status(400).json({ error: "Stock name (Company Name (Symbol)) is required." });
    }

    try {
        console.log(`Processing sentiment analysis for stock: ${stockInput}`);
        const prediction = await predictStockMovement(stockInput, 50);

        // Save prediction data to a JSON file
        const outputData = { stockInput, prediction };
        fs.writeFileSync("stock_sentiment_output.json", JSON.stringify(outputData, null, 2));

        res.json(outputData);
    } catch (error) {
        console.error("Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Start Express server
const PORT = 4000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// If the script is run directly, prompt for input
if (require.main === module) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question("Enter stock name (Company Name (Symbol)): ", async (stockInput) => {
        if (!stockInput) {
            console.log("Stock name is required.");
            rl.close();
            return;
        }

        console.log(`Fetching sentiment analysis for ${stockInput}...`);
        const prediction = await predictStockMovement(stockInput, 50);
        console.log(prediction);

        rl.close();
    });
}
