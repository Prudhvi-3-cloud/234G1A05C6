"use strict";

// Load environment variables from .env file
require("dotenv").config();

// Import required packages
const express = require("express");
const axios = require("axios");

// Import custom logging middleware functions
const { setToken, logDebug, logInfo, logWarn, logFatal } = require("../logging_middleware");

const app = express();

// Base URL of the evaluation service
const BASE_URL = "http://4.224.186.213/evaluation-service";

// Credentials used for authentication
const CREDENTIALS = {
  email: process.env.API_EMAIL,
  name: process.env.API_NAME,
  rollNo: process.env.API_ROLL_NO,
  accessCode: process.env.API_ACCESS_CODE,
  clientID: process.env.API_CLIENT_ID,
  clientSecret: process.env.API_CLIENT_SECRET,
};

// Stores authentication token
let TOKEN = "";

// Authenticate and obtain access token
async function authenticate() {
  const { data } = await axios.post(`${BASE_URL}/auth`, CREDENTIALS);

  TOKEN = data.access_token;

  // Store token for logging service usage
  setToken(TOKEN);

  // Log successful authentication
  await logInfo("auth", "auth success - token obtained");
}

// Generate authorization header
function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}` };
}

// Solves the maintenance task allocation problem using Knapsack DP
function solveKnapsack(tasks, budget) {

  // Return empty result if budget is invalid
  if (budget <= 0) return { selectedTasks: [], totalDuration: 0, totalImpact: 0 };

  // Keep only tasks that fit inside the budget
  const feasibleTasks = tasks.filter((task) => task.Duration <= budget);

  // No valid tasks available
  if (feasibleTasks.length === 0) return { selectedTasks: [], totalDuration: 0, totalImpact: 0 };

  // Calculate total duration of all feasible tasks
  const totalFeasibleDuration = feasibleTasks.reduce((sum, task) => sum + task.Duration, 0);

  // If all tasks fit, select all directly
  if (totalFeasibleDuration <= budget) {
    return {
      selectedTasks: feasibleTasks,
      totalDuration: totalFeasibleDuration,
      totalImpact: feasibleTasks.reduce((sum, task) => sum + task.Impact, 0),
    };
  }

  // Sort tasks based on impact per duration ratio
  const sortedTasks = [...feasibleTasks].sort(
    (a, b) => (b.Impact / b.Duration) - (a.Impact / a.Duration)
  );

  const taskCount = sortedTasks.length;
  const effectiveBudget = Math.min(budget, totalFeasibleDuration);

  // DP array to store maximum impact
  const maxImpact = new Array(effectiveBudget + 1).fill(0);

  // Track selected items during DP computation
  const itemTracker = Array.from({ length: taskCount }, () => new Array(effectiveBudget + 1).fill(false));

  // Dynamic Programming computation
  for (let i = 0; i < taskCount; i++) {
    const duration = sortedTasks[i].Duration;
    const impact = sortedTasks[i].Impact;

    for (let currentCapacity = effectiveBudget; currentCapacity >= duration; currentCapacity--) {

      const potentialImpact = maxImpact[currentCapacity - duration] + impact;

      // Update DP table if better impact is found
      if (potentialImpact > maxImpact[currentCapacity]) {
        maxImpact[currentCapacity] = potentialImpact;
        itemTracker[i][currentCapacity] = true;
      }
    }
  }

  // Reconstruct selected tasks from DP table
  const selectedTasks = [];
  let remainingCapacity = effectiveBudget;

  for (let i = taskCount - 1; i >= 0; i--) {
    if (itemTracker[i][remainingCapacity]) {
      selectedTasks.push(sortedTasks[i]);
      remainingCapacity -= sortedTasks[i].Duration;
    }
  }

  // Return optimized result
  return {
    selectedTasks,
    totalDuration: selectedTasks.reduce((sum, task) => sum + task.Duration, 0),
    totalImpact: maxImpact[effectiveBudget],
  };
}

// ---------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------

// Generate maintenance schedule for all depots
app.get("/schedule", async (req, res) => {
  try {

    // Log incoming request
    await logInfo("handler", "incoming request - GET /schedule");
    await logInfo("service", "fetching depots and vehicles");

    // Fetch depots and vehicles concurrently
    const [depotRes, vehicleRes] = await Promise.all([
      axios.get(`${BASE_URL}/depots`, { headers: authHeaders() }),
      axios.get(`${BASE_URL}/vehicles`, { headers: authHeaders() }),
    ]);

    const depots = depotRes.data.depots || [];
    const vehicles = vehicleRes.data.vehicles || [];

    await logInfo("service", `d:${depots.length} v:${vehicles.length}`);
    await logDebug("handler", "validating records");

    // Validate depot records
    const validDepots = depots.filter((d) => {
      if (typeof d.ID === "number" && typeof d.MechanicHours === "number" && d.MechanicHours > 0) {
        return true;
      }

      // Log invalid depot
      logWarn("handler", `bad depot:${d.ID}`.slice(0, 48));
      return false;
    });

    // Validate vehicle tasks
    const validTasks = vehicles.filter((v) => {
      if (typeof v.TaskID === "string" && typeof v.Duration === "number" && typeof v.Impact === "number" && v.Duration > 0) {
        return true;
      }

      // Log invalid vehicle
      logWarn("handler", "bad vehicle skipped");
      return false;
    });

    const schedule = [];

    // Create optimized schedule for each depot
    for (const depot of validDepots) {

      const budget = depot.MechanicHours;

      await logDebug("service", `depot ${depot.ID} | budget:${budget}h`.slice(0, 48));

      // Get optimal task selection
      const { selectedTasks, totalDuration, totalImpact } = solveKnapsack(validTasks, budget);

      // Calculate resource utilization percentage
      const utilizationPct = ((totalDuration / budget) * 100).toFixed(1);

      // Warn if utilization is too low
      if (parseFloat(utilizationPct) < 50) {
        await logWarn("service", `depot ${depot.ID} low util:${utilizationPct}%`.slice(0, 48));
      }

      // Add depot schedule to final response
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

    // Log successful schedule generation
    await logInfo("handler", "schedule ready - sending response");

    return res.status(200).json({
      success: true,
      totalDepots: schedule.length,
      schedule,
    });

  } catch (err) {

    // Log fatal error
    await logFatal("handler", `/schedule err:${err.message}`.slice(0, 48));

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ---------------------------------------------------------
// Initialization
// ---------------------------------------------------------

// Authenticate before starting server
authenticate()
  .then(() => {

    // Start Express server
    app.listen(3000, () => {
      console.log("Vehicle Maintenance Scheduler running on port 3000");
      console.log("GET http://localhost:3000/schedule");
    });
  })
  .catch((err) => {

    // Authentication failure
    console.error("Authentication failed:", err.response?.data || err.message);

    process.exit(1);
  });