const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = 4000;

app.use(cors());

const API_KEY = "GINJRH2433MOIVNU"; // Replace with your actual API key

// Function to fetch stock data
const fetchStockData = async (symbol) => {
  try {
    console.log(`Fetching stock data for: ${symbol}`); // Debugging log

    const response = await axios.get(
      `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=5min&apikey=${API_KEY}`
    );

    console.log("Raw API Response:", response.data); // Check full API response

    if (!response.data || !response.data["Time Series (5min)"]) {
      throw new Error("Invalid API response: Missing time series data");
    }

    const timeSeries = response.data["Time Series (5min)"];
    const priceHistory = Object.entries(timeSeries).map(([time, values]) => ({
      time,
      price: parseFloat(values["1. open"]),
    }));

    if (priceHistory.length === 0) {
      throw new Error("Price history is empty");
    }

    // Risk Analysis (Basic Volatility Calculation)
    const riskAnalysis = priceHistory.map((entry, index, arr) => {
      if (index === 0) return { time: entry.time, risk: 50 }; // Default for first entry
      const priceDiff = Math.abs(entry.price - arr[index - 1].price);
      return {
        time: entry.time,
        risk: Math.min(100, priceDiff * 10), // Scaled risk score
      };
    });

    console.log("Generated Data:", { priceHistory, riskAnalysis }); // Debugging log

    return { priceHistory, riskAnalysis };
  } catch (error) {
    console.error("Error fetching stock data:", error.message);
    return { priceHistory: [], riskAnalysis: [] };
  }
};

// API Route for fetching stock data
app.get("/predictStock", async (req, res) => {
  const { stock } = req.query;
  if (!stock) {
    return res.status(400).json({ error: "Stock symbol required" });
  }

  console.log(`Fetching stock data for: ${stock}`); // Debugging log

  const stockData = await fetchStockData(stock);

  if (!stockData.priceHistory.length) {
    return res.status(500).json({ error: "No stock data available" });
  }

  res.json({ symbol: stock, ...stockData });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
