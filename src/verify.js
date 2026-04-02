const crypto = require("crypto");

/**
 * Verifies that an incoming webhook request was sent by monday.com.
 *
 * Supports two auth modes:
 *   1. Classic webhooks: HMAC-SHA256 via x-monday-signature header
 *   2. Workflow blocks: JWT via authorization header (logged but allowed)
 */
function verifyMondaySignature(req, res, next) {
  // Classic HMAC signature (API-created webhooks)
  const signature = req.headers["x-monday-signature"];

  if (signature) {
    const signingSecret = process.env.MONDAY_SIGNING_SECRET;
    if (!signingSecret) {
      console.error("MONDAY_SIGNING_SECRET is not set");
      return res.status(500).json({ error: "Server misconfiguration" });
    }

    const hmac = crypto.createHmac("sha256", signingSecret);
    hmac.update(req.rawBody);
    const digest = "sha256=" + hmac.digest("hex");

    if (digest !== signature) {
      console.warn("Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    return next();
  }

  // Workflow block calls use an authorization JWT instead
  if (req.headers["authorization"]) {
    console.log("Workflow block request (authorization header present)");
    return next();
  }

  console.warn("No authentication header found on request");
  return res.status(401).json({ error: "Missing signature" });
}

module.exports = { verifyMondaySignature };
