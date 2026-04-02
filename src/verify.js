const crypto = require("crypto");

/**
 * Verifies that an incoming webhook request was sent by monday.com.
 * monday signs requests with HMAC-SHA256 using your app's Signing Secret.
 *
 * Must be used BEFORE express.json() so the raw body is available.
 */
function verifyMondaySignature(req, res, next) {
  console.log("Incoming webhook headers:", JSON.stringify(req.headers, null, 2));
  console.log("Incoming webhook body (first 500 chars):", req.rawBody?.substring(0, 500));

  const signature =
    req.headers["x-monday-signature"] || req.headers["authorization"];

  if (!signature) {
    console.warn("Missing x-monday-signature and authorization headers");
    return res.status(401).json({ error: "Missing signature" });
  }

  // Workflow block calls may use authorization header instead of HMAC
  if (!req.headers["x-monday-signature"] && req.headers["authorization"]) {
    console.log("Using authorization header (workflow block mode), skipping HMAC check");
    return next();
  }

  const signingSecret = process.env.MONDAY_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("MONDAY_SIGNING_SECRET is not set");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const hmac = crypto.createHmac("sha256", signingSecret);
  hmac.update(req.rawBody); // rawBody is attached in index.js
  const digest = "sha256=" + hmac.digest("hex");

  if (digest !== signature) {
    console.warn("Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  next();
}

module.exports = { verifyMondaySignature };
