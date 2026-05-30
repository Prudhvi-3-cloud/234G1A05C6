"use strict";

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { setToken, logDebug, logInfo, logWarn, logFatal } = require("../logging_middleware");

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || "http://4.224.186.213/evaluation-service";

const API_CREDENTIALS = {
  email: process.env.EMAIL,
  name: process.env.NAME,
  rollNo: process.env.ROLL_NO,
  accessCode: process.env.ACCESS_CODE,
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
};

let activeToken = "";

// Authenticate and store the access token
async function establishConnection() {
  const response = await axios.post(`${BASE_URL}/auth`, API_CREDENTIALS);
  activeToken = response.data.access_token;
  setToken(activeToken);
  await logInfo("auth", "Session token successfully refreshed".slice(0, 48));
}

function getAuthHeader() {
  return { Authorization: `Bearer ${activeToken}` };
}

// ---------------------------------------------------------
// Priority Scoring Engine
// ---------------------------------------------------------

const CATEGORY_BASE_SCORES = {
  Result: 100,
  Placement: 70,
  Event: 40,
};

const MAX_BONUS_HOURS = 30;

/**
 * Converts the API timestamp into hours elapsed since publication.
 */
function calculateHoursPassed(dateString, currentMs) {
  // Convert "YYYY-MM-DD HH:MM:SS" to valid ISO format
  const validIsoString = dateString.replace(" ", "T") + "Z";
  const publishedMs = new Date(validIsoString).getTime();
  
  return (currentMs - publishedMs) / (1000 * 60 * 60);
}

/**
 * Calculates total priority based on alert type and recency.
 */
function calculateRelevance(alert, currentMs) {
  const baseScore = CATEGORY_BASE_SCORES[alert.Type] || 10;
  const hoursPassed = calculateHoursPassed(alert.Timestamp, currentMs);
  
  // Decays 1 point per hour, bottoming out at 0
  const timeBonus = Math.max(0, MAX_BONUS_HOURS - hoursPassed);
  
  return Number((baseScore + timeBonus).toFixed(2));
}

/**
 * Validates, scores, and sorts the alerts in a single pass.
 */
function generateRankedFeed(rawAlerts) {
  const currentMs = Date.now();
  const processedFeed = [];

  for (const alert of rawAlerts) {
    // Inline validation checks
    const isValid = 
      typeof alert.ID === "string" &&
      typeof alert.Type === "string" &&
      typeof alert.Message === "string" &&
      typeof alert.Timestamp === "string";

    if (isValid) {
      processedFeed.push({
        ...alert,
        priorityScore: calculateRelevance(alert, currentMs),
      });
    } else {
      logWarn("service", "Invalid alert omitted from feed".slice(0, 48));
    }
  }

  // Sort descending by highest score
  return processedFeed.sort((a, b) => b.priorityScore - a.priorityScore);
}

// ---------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------

app.get("/notifications", async (req, res) => {
  try {
    await logInfo("handler", "GET /notifications request received".slice(0, 48));
    await logInfo("service", "Requesting external alerts via API".slice(0, 48));

    const { data } = await axios.get(`${BASE_URL}/notifications`, {
      headers: getAuthHeader(),
    });

    const unparsedAlerts = data.notifications || [];

    if (unparsedAlerts.length === 0) {
      await logWarn("service", "API returned an empty alert array".slice(0, 48));
      return res.status(200).json({
        success: true,
        totalNotifications: 0,
        priorityInbox: [],
      });
    }

    await logDebug("service", `Evaluating ${unparsedAlerts.length} items`.slice(0, 48));

    const priorityInbox = generateRankedFeed(unparsedAlerts);
    
    await logInfo("service", "Feed successfully ranked and sorted".slice(0, 48));
    await logInfo("handler", "Transmitting final payload to client".slice(0, 48));

    return res.status(200).json({
      success: true,
      totalNotifications: priorityInbox.length,
      priorityInbox,
    });

  } catch (error) {
    const errorMsg = `/notifications fail: ${error.message}`;
    await logFatal("handler", errorMsg.slice(0, 48));
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "operational", routes: ["/notifications"] });
});

// ---------------------------------------------------------
// Server Initialization
// ---------------------------------------------------------

establishConnection()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Priority Inbox running on port ${PORT}`);
      console.log(`👉 GET http://localhost:${PORT}/notifications`);
    });
  })
  .catch((error) => {
    console.error("❌ Authentication failure:", error.response?.data || error.message);
    process.exit(1);
  });