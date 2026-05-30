"use strict";

const LOG_ENDPOINT = "http://4.224.186.213/evaluation-service/logs";

const VALID_STACKS = ["backend", "frontend"];
const VALID_LEVELS = ["debug", "info", "warn", "error", "fatal"];

const VALID_PACKAGES = {
  backend: ["cache","controller","cron_job","db","domain","handler","repository","route","service"],
  frontend: ["api", "component", "hook", "page", "state", "style"],
  both: ["auth", "config", "middleware", "utils"],
};

function isValidPackage(stack, pkg) {
  const stackSpecific = VALID_PACKAGES[stack] || [];
  const shared = VALID_PACKAGES.both;
  return stackSpecific.includes(pkg) || shared.includes(pkg);
}

function validateFields(stack, level, pkg, message) {
  if (!stack || typeof stack !== "string") throw new Error("[Logger] 'stack' must be a non-empty string.");
  if (!VALID_STACKS.includes(stack)) throw new Error(`[Logger] Invalid stack '${stack}'. Allowed: ${VALID_STACKS.join(", ")}`);
  if (!level || typeof level !== "string") throw new Error("[Logger] 'level' must be a non-empty string.");
  if (!VALID_LEVELS.includes(level)) throw new Error(`[Logger] Invalid level '${level}'. Allowed: ${VALID_LEVELS.join(", ")}`);
  if (!pkg || typeof pkg !== "string") throw new Error("[Logger] 'package' must be a non-empty string.");
  if (!isValidPackage(stack, pkg)) {
    const allowed = [...VALID_PACKAGES[stack], ...VALID_PACKAGES.both].join(", ");
    throw new Error(`[Logger] Invalid package '${pkg}' for stack '${stack}'. Allowed: ${allowed}`);
  }
  if (!message || typeof message !== "string" || message.trim() === "") throw new Error("[Logger] 'message' must be a non-empty string.");
}

let _accessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJNYXBDbGFpbXMiOnsiYXVkIjoiaHR0cDovLzIwLjI0NC41Ni4xNDQvZXZhbHVhdGlvbi1zZXJ2aWNlIiwiZW1haWwiOiIyMzRnMWEwNWM2QHNyaXQuYWMuaW4iLCJleHAiOjE3ODAxMTkxNDEsImlhdCI6MTc4MDExODI0MSwiaXNzIjoiQWZmb3JkIE1lZGljYWwgVGVjaG5vbG9naWVzIFByaXZhdGUgTGltaXRlZCIsImp0aSI6ImQ1Nzg4ZjQ2LTEyZWMtNDIyMi05NWUzLTAxNTA2ODQ0NTA4ZiIsImxvY2FsZSI6ImVuLUlOIiwibmFtZSI6InBydWRodmkgcCIsInN1YiI6ImFkZTAyYzAyLWYyZDYtNGI1ZS05MzJmLTQyMzY4ZGU1MDFiZiJ9LCJlbWFpbCI6IjIzNGcxYTA1YzZAc3JpdC5hYy5pbiIsIm5hbWUiOiJwcnVkaHZpIHAiLCJyb2xsTm8iOiIyMzRnMWEwNWM2IiwiYWNjZXNzQ29kZSI6IlNka2pKRyIsImNsaWVudElEIjoiYWRlMDJjMDItZjJkNi00YjVlLTkzMmYtNDIzNjhkZTUwMWJmIiwiY2xpZW50U2VjcmV0IjoieUtnRWplVEdFc1JqV2pCYSJ9.I9w2LbK794riGfIR_dEdbD37hkJNCnEl54pneSfBloY";

function setToken(token) {
  if (!token || typeof token !== "string") throw new Error("[Logger] setToken() requires a valid non-empty string.");
  _accessToken = token.trim();
}

function getToken() {
  if (!_accessToken) throw new Error("[Logger] Access token not set. Call setToken(token) before logging.");
  return _accessToken;
}

async function log(stack, level, pkg, message) {
  validateFields(stack, level, pkg, message);
  const payload = { stack, level, package: pkg, message };
  let response;
  try {
    response = await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    console.error(`[Logger] Network error — ${networkErr.message}`);
    console.error("[Logger] Dropped log entry:", payload);
    return null;
  }
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Logger] Server rejected log (HTTP ${response.status}): ${errorBody}`);
    return null;
  }
  return await response.json();
}

const logDebug = (pkg, message) => log("backend", "debug", pkg, message);
const logInfo  = (pkg, message) => log("backend", "info",  pkg, message);
const logWarn  = (pkg, message) => log("backend", "warn",  pkg, message);
const logError = (pkg, message) => log("backend", "error", pkg, message);
const logFatal = (pkg, message) => log("backend", "fatal", pkg, message);

module.exports = { log, setToken, logDebug, logInfo, logWarn, logError, logFatal, VALID_STACKS, VALID_LEVELS, VALID_PACKAGES };