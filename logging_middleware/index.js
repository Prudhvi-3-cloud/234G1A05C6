"use strict";

const LOG_ENDPOINT = "http://4.224.186.213/evaluation-service/logs";

const VALID_STACKS = ["backend", "frontend"];
const VALID_LEVELS = ["debug", "info", "warn", "error", "fatal"];

const VALID_PACKAGES = {
  backend: ["cache", "controller", "cron_job", "db", "domain", "handler", "repository", "route", "service"],
  frontend: ["api", "component", "hook", "page", "state", "style"],
  both: ["auth", "config", "middleware", "utils"],
};

// Start with an empty token; it will be injected by the server on startup
let _accessToken = ""; 

// Checks if a package name is allowed for a given stack
function isValidPackage(stack, pkg) {
  const allowedForStack = VALID_PACKAGES[stack] || [];
  const allowedForBoth = VALID_PACKAGES.both;
  return allowedForStack.includes(pkg) || allowedForBoth.includes(pkg);
}

// Ensures all log data is formatted correctly before sending
function validateLogInput(stack, level, pkg, message) {
  if (!VALID_STACKS.includes(stack)) throw new Error(`[Logger] Invalid stack. Allowed: ${VALID_STACKS.join(", ")}`);
  if (!VALID_LEVELS.includes(level)) throw new Error(`[Logger] Invalid level. Allowed: ${VALID_LEVELS.join(", ")}`);
  
  if (!isValidPackage(stack, pkg)) {
    const allowed = [...(VALID_PACKAGES[stack] || []), ...VALID_PACKAGES.both].join(", ");
    throw new Error(`[Logger] Invalid package '${pkg}' for stack '${stack}'. Allowed: ${allowed}`);
  }
  
  if (!message || message.trim() === "") throw new Error("[Logger] 'message' cannot be empty.");
}

function setToken(token) {
  if (!token || typeof token !== "string") throw new Error("[Logger] Invalid token provided.");
  _accessToken = token.trim();
}

function getToken() {
  if (!_accessToken) throw new Error("[Logger] Access token is missing. Call setToken() first.");
  return _accessToken;
}

// Main logging function that pushes data to the external service
async function log(stack, level, pkg, message) {
  validateLogInput(stack, level, pkg, message);
  
  const payload = { stack, level, package: pkg, message };

  try {
    const response = await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${getToken()}` 
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Logger] Server rejected log (HTTP ${response.status}): ${errorText}`);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error(`[Logger] Network error: ${err.message}`);
    console.error("[Logger] Dropped log payload:", payload);
    return null;
  }
}

// Helper functions for common backend logging
const logDebug = (pkg, message) => log("backend", "debug", pkg, message);
const logInfo  = (pkg, message) => log("backend", "info", pkg, message);
const logWarn  = (pkg, message) => log("backend", "warn", pkg, message);
const logError = (pkg, message) => log("backend", "error", pkg, message);
const logFatal = (pkg, message) => log("backend", "fatal", pkg, message);

module.exports = { 
  log, 
  setToken, 
  logDebug, 
  logInfo, 
  logWarn, 
  logError, 
  logFatal, 
  VALID_STACKS, 
  VALID_LEVELS, 
  VALID_PACKAGES 
};