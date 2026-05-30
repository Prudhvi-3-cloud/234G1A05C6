"use strict";

require("dotenv").config();

const express = require("express");
const axios   = require("axios");
const { setToken, logDebug, logInfo, logWarn, logFatal } =
  require("../logging_middleware");

const app  = express();
const PORT = process.env.PORT || 3001;
const BASE = process.env.BASE_URL || "http://4.224.186.213/evaluation-service";

const CREDENTIALS = {
  email:        process.env.EMAIL,
  name:         process.env.NAME,
  rollNo:       process.env.ROLL_NO,
  accessCode:   process.env.ACCESS_CODE,
  clientID:     process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
};

let TOKEN = "";

async function authenticate() {
  const { data } = await axios.post(`${BASE}/auth`, CREDENTIALS);
  TOKEN = data.access_token;
  setToken(TOKEN);
  await logInfo("auth", "token refreshed");
}

function authHeaders() {
  return { Authorization: `Bearer ${TOKEN}` };
}

// ═══════════════════════════════════════════════════════════
//  PRIORITY SCORING ALGORITHM
//
//  Real API shape: { ID, Type, Message, Timestamp }
//  Real types   : Result | Placement | Event
//
//  Score = typeWeight + freshness
//
//  typeWeight: Result=100, Placement=70, Event=40
//    Result   — exam results affect student future directly
//    Placement— hiring alerts are time-sensitive (deadlines)
//    Event    — college events, lowest urgency
//
//  freshness: max(0, 30 − ageInHours)
//    Decays 1 point per hour over 30 hours.
//    A brand-new notification scores +30 on top of its type.
//    Older than 30 hours → +0 bonus.
//
//  FINAL SCORE = typeWeight + freshness
//
//  WHY NO READ PENALTY?
//  The API has no `read` field — notifications are anonymous
//  (no userID either). So we sort purely on type + recency.
//
//  COMPLEXITY: O(n) scoring + O(n log n) sort — optimal
// ═══════════════════════════════════════════════════════════

const TYPE_WEIGHT = {
  "Result":    100,
  "Placement":  70,
  "Event":      40,
};

/**
 * Score one notification.
 * Timestamp from the API is "YYYY-MM-DD HH:MM:SS" (no timezone).
 * We treat it as UTC by replacing the space with T and appending Z.
 */
function scoreNotification(n, nowMs) {
  const weight    = TYPE_WEIGHT[n.Type] ?? 10;
  const ts        = n.Timestamp.replace(" ", "T") + "Z";
  const ageHours  = (nowMs - new Date(ts).getTime()) / 3_600_000;
  const freshness = Math.max(0, 30 - ageHours);
  return parseFloat((weight + freshness).toFixed(2));
}

/**
 * Sort all notifications by priority score (highest first).
 * Returns enriched array with priorityScore attached to each item.
 */
function buildPriorityInbox(notifications) {
  const nowMs = Date.now();

  return notifications
    .map(n => ({ ...n, priorityScore: scoreNotification(n, nowMs) }))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

// ── GET /notifications ─────────────────────────────────────

app.get("/notifications", async (req, res) => {
  try {
    await logInfo("handler", "incoming GET /notifications");
    await logInfo("service", "fetching notifications from API");

    const { data } = await axios.get(`${BASE}/notifications`, {
      headers: authHeaders(),
    });

    const raw = data.notifications ?? [];

    if (raw.length === 0) {
      await logWarn("service", "no notifications returned");
      return res.status(200).json({
        success:              true,
        totalNotifications:   0,
        priorityInbox:        [],
      });
    }

    await logDebug("service", `fetched:${raw.length} notifications`);

    // Validate — drop records missing required fields
    const valid = raw.filter((n) => {
      const ok = typeof n.ID        === "string"
              && typeof n.Type      === "string"
              && typeof n.Message   === "string"
              && typeof n.Timestamp === "string";
      if (!ok) logWarn("service", "bad record skipped");
      return ok;
    });

    await logInfo("service", "scoring notifications");
    const priorityInbox = buildPriorityInbox(valid);
    await logInfo("service", "priority inbox built");
    await logInfo("handler", "response sent");

    return res.status(200).json({
      success:            true,
      totalNotifications: priorityInbox.length,
      priorityInbox,
    });

  } catch (err) {
    await logFatal("handler", `/notifications err:${err.message}`.slice(0, 48));
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "ok", routes: ["/notifications"] });
});

// ── START ──────────────────────────────────────────────────

authenticate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅  Notification Priority Inbox on port ${PORT}`);
      console.log(`    GET http://localhost:${PORT}/notifications`);
    });
  })
  .catch((err) => {
    console.error("❌  Auth failed:", err.response?.data || err.message);
    process.exit(1);
  });