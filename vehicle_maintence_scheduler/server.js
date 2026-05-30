"use strict";

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { setToken, logDebug, logInfo, logWarn, logFatal } = require("../logging_middleware");

const app = express();
const BASE_URL = "http://4.224.186.213/evaluation-service";

const CREDENTIALS = {
  email: process.env.API_EMAIL,
  name: process.env.API_NAME,
  rollNo: process.env.API_ROLL_NO,
  accessCode: process.env.API_ACCESS_CODE,
  clientID: process.env.API_CLIENT_ID,
  clientSecret: process.env.API_CLIENT_SECRET,
};

let TOKEN = "";

async function authenticate() {
  const { data } = await axios.post(`${BASE_URL}/auth`, CREDENTIALS);
  TOKEN = data.access_token;
  setToken(TOKEN);
  // Shortened to 29 characters
  await logInfo("auth", "auth success - token obtained");
}

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}` };
}

function solveKnapsack(tasks, budget) {
  if (budget <= 0) return { selectedTasks: [], totalDuration: 0, totalImpact: 0 };

  const feasibleTasks = tasks.filter((task) => task.Duration <= budget);
  if (feasibleTasks.length === 0) return { selectedTasks: [], totalDuration: 0, totalImpact: 0 };

  const totalFeasibleDuration = feasibleTasks.reduce((sum, task) => sum + task.Duration, 0);
  if (totalFeasibleDuration <= budget) {
    return {
      selectedTasks: feasibleTasks,
      totalDuration: totalFeasibleDuration,
      totalImpact: feasibleTasks.reduce((sum, task) => sum + task.Impact, 0),
    };
  }

  const sortedTasks = [...feasibleTasks].sort(
    (a, b) => (b.Impact / b.Duration) - (a.Impact / a.Duration)
  );

  const taskCount = sortedTasks.length;
  const effectiveBudget = Math.min(budget, totalFeasibleDuration);

  const maxImpact = new Array(effectiveBudget + 1).fill(0);
  const itemTracker = Array.from({ length: taskCount }, () => new Array(effectiveBudget + 1).fill(false));

  for (let i = 0; i < taskCount; i++) {
    const duration = sortedTasks[i].Duration;
    const impact = sortedTasks[i].Impact;

    for (let currentCapacity = effectiveBudget; currentCapacity >= duration; currentCapacity--) {
      const potentialImpact = maxImpact[currentCapacity - duration] + impact;
      
      if (potentialImpact > maxImpact[currentCapacity]) {
        maxImpact[currentCapacity] = potentialImpact;
        itemTracker[i][currentCapacity] = true;
      }
    }
  }

  const selectedTasks = [];
  let remainingCapacity = effectiveBudget;
  
  for (let i = taskCount - 1; i >= 0; i--) {
    if (itemTracker[i][remainingCapacity]) {
      selectedTasks.push(sortedTasks[i]);
      remainingCapacity -= sortedTasks[i].Duration;
    }
  }

  return {
    selectedTasks,
    totalDuration: selectedTasks.reduce((sum, task) => sum + task.Duration, 0),
    totalImpact: maxImpact[effectiveBudget],
  };
}

// ---------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------

app.get("/schedule", async (req, res) => {
  try {
    await logInfo("handler", "incoming request - GET /schedule");
    await logInfo("service", "fetching depots and vehicles");

    const [depotRes, vehicleRes] = await Promise.all([
      axios.get(`${BASE_URL}/depots`, { headers: authHeaders() }),
      axios.get(`${BASE_URL}/vehicles`, { headers: authHeaders() }),
    ]);

    const depots = depotRes.data.depots || [];
    const vehicles = vehicleRes.data.vehicles || [];

    await logInfo("service", `d:${depots.length} v:${vehicles.length}`);
    await logDebug("handler", "validating records");

    const validDepots = depots.filter((d) => {
      if (typeof d.ID === "number" && typeof d.MechanicHours === "number" && d.MechanicHours > 0) {
        return true;
      }
      // Added slice to guarantee it stays under 48 chars
      logWarn("handler", `bad depot:${d.ID}`.slice(0, 48));
      return false;
    });

    const validTasks = vehicles.filter((v) => {
      if (typeof v.TaskID === "string" && typeof v.Duration === "number" && typeof v.Impact === "number" && v.Duration > 0) {
        return true;
      }
      logWarn("handler", "bad vehicle skipped");
      return false;
    });

    const schedule = [];

    for (const depot of validDepots) {
      const budget = depot.MechanicHours;
      await logDebug("service", `depot ${depot.ID} | budget:${budget}h`.slice(0, 48));

      const { selectedTasks, totalDuration, totalImpact } = solveKnapsack(validTasks, budget);

      const utilizationPct = ((totalDuration / budget) * 100).toFixed(1);

      if (parseFloat(utilizationPct) < 50) {
        await logWarn("service", `depot ${depot.ID} low util:${utilizationPct}%`.slice(0, 48));
      }

      schedule.push({
        depotID: depot.ID,
        budget: budget,
        hoursUsed: totalDuration,
        totalImpact: totalImpact,
        utilisation: `${utilizationPct}%`,
        tasksSelected: selectedTasks.length,
        selectedTasks: selectedTasks,
      });
    }

    await logInfo("handler", "schedule ready - sending response");

    return res.status(200).json({
      success: true,
      totalDepots: schedule.length,
      schedule,
    });

  } catch (err) {
    // Slices exactly at 48 characters to prevent crash logs from failing
    await logFatal("handler", `/schedule err:${err.message}`.slice(0, 48));
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------
// Initialization
// ---------------------------------------------------------

authenticate()
  .then(() => {
    app.listen(3000, () => {
      console.log("✅ Vehicle Maintenance Scheduler running on port 3000");
      console.log("👉 GET http://localhost:3000/schedule");
    });
  })
  .catch((err) => {
    console.error("❌ Authentication failed:", err.response?.data || err.message);
    process.exit(1);
  });