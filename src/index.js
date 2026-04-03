require("dotenv").config();
const express = require("express");
const path = require("path");
const { verifyMondaySignature } = require("./verify");
const { handleStatusChangedToDone } = require("./handler");
const {
  createWebhookSubscription,
  deleteWebhookSubscription,
  findOurWebhooks,
} = require("./mondayClient");

const app = express();
const PORT = process.env.PORT || 3000;

// Capture raw body for HMAC signature verification before JSON parsing
app.use((req, res, next) => {
  let data = "";
  req.on("data", (chunk) => (data += chunk));
  req.on("end", () => {
    req.rawBody = data;
    try {
      req.body = data ? JSON.parse(data) : {};
    } catch {
      req.body = {};
    }
    next();
  });
});

// Serve the board view static page
app.use("/view", express.static(path.join(__dirname, "public")));

// ─── Health check ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "monday-dependency-automation" });
});

// ─── Webhook management API ─────────────────────────────────────────────────

// POST /setup — enable automation on a board
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
    res.json({ success: true, enabled: true, boardId, webhookUrl, result });
  } catch (err) {
    console.error("Failed to register webhook:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /setup/status?boardId=123 — check if automation is enabled
app.get("/setup/status", async (req, res) => {
  const { boardId } = req.query;
  if (!boardId) {
    return res.status(400).json({ error: "boardId query param is required" });
  }
  try {
    const host = req.headers.host;
    const webhooks = await findOurWebhooks(boardId, host);
    res.json({ boardId, enabled: webhooks.length > 0, webhooks });
  } catch (err) {
    res.json({ boardId, enabled: false, webhooks: [] });
  }
});

// DELETE /setup — disable automation on a board
app.delete("/setup", async (req, res) => {
  const { boardId } = req.body;
  if (!boardId) {
    return res.status(400).json({ error: "boardId is required" });
  }

  try {
    const host = req.headers.host;
    const webhooks = await findOurWebhooks(boardId, host);

    if (webhooks.length === 0) {
      return res.json({ success: true, enabled: false, message: "No webhooks found" });
    }

    for (const wh of webhooks) {
      await deleteWebhookSubscription(wh.id);
      console.log(`Webhook ${wh.id} deleted for board ${boardId}`);
    }

    res.json({ success: true, enabled: false, removed: webhooks.length });
  } catch (err) {
    console.error("Failed to remove webhooks:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── monday challenge handshake ──────────────────────────────────────────────
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
    res.json({ status: "received" });

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
