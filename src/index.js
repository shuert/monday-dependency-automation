require("dotenv").config();
const express = require("express");
const { verifyMondaySignature } = require("./verify");
const { handleStatusChangedToDone } = require("./handler");
const {
  createWebhookSubscription,
  listWebhooks,
} = require("./mondayClient");

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

// ─── Webhook setup ───────────────────────────────────────────────────────────
// POST /setup with { "boardId": 123456789 } to register a webhook on a board.
// monday will immediately send a challenge to /webhook (handled below).
app.post("/setup", async (req, res) => {
  const { boardId } = req.body;
  if (!boardId) {
    return res.status(400).json({ error: "boardId is required" });
  }

  const protocol = req.headers["x-forwarded-proto"] || "https";
  const webhookUrl = `${protocol}://${req.headers.host}/webhook`;

  try {
    const result = await createWebhookSubscription(boardId, webhookUrl);
    console.log(`Webhook registered for board ${boardId} → ${webhookUrl}`);
    res.json({ success: true, boardId, webhookUrl, result });
  } catch (err) {
    console.error("Failed to register webhook:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /setup?boardId=123 to list existing webhooks for a board
app.get("/setup", async (req, res) => {
  const { boardId } = req.query;
  if (!boardId) {
    return res.status(400).json({ error: "boardId query param is required" });
  }
  try {
    const webhooks = await listWebhooks(boardId);
    res.json({ boardId, webhooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
