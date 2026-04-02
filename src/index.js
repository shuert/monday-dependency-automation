require("dotenv").config();
const express = require("express");
const { verifyMondaySignature } = require("./verify");
const { handleStatusChangedToDone } = require("./handler");

const app = express();
const PORT = process.env.PORT || 3000;

// Capture raw body for HMAC signature verification before JSON parsing
app.use((req, res, next) => {
  let data = "";
  req.on("data", (chunk) => (data += chunk));
  req.on("end", () => {
    req.rawBody = data;
    req.body = data ? JSON.parse(data) : {};
    next();
  });
});

// ─── Health check ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "monday-dependency-automation" });
});

// ─── monday challenge handshake ──────────────────────────────────────────────
// When you register a webhook URL in monday, it sends a challenge request
// that must be echoed back immediately to verify ownership of the endpoint.
app.post("/webhook", (req, res, next) => {
  if (req.body?.challenge) {
    console.log("Responding to monday challenge handshake");
    return res.json({ challenge: req.body.challenge });
  }
  next();
});

// ─── Automation webhook ──────────────────────────────────────────────────────
app.post(
  "/webhook",
  verifyMondaySignature,
  async (req, res) => {
    // Acknowledge immediately — monday expects a fast 200 response
    res.json({ status: "received" });

    // Process asynchronously so we don't block the response
    try {
      await handleStatusChangedToDone(req.body);
    } catch (err) {
      console.error("Error processing webhook:", err.message);
    }
  }
);

// ─── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`monday-dependency-automation listening on port ${PORT}`);
});
