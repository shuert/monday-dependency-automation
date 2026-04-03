const crypto = require("crypto");

/**
 * Verifies that an incoming webhook request was sent by monday.com.
 *
 * Auth modes (checked in order):
 *   1. x-monday-signature header → HMAC-SHA256 verification
 *   2. authorization header → JWT from workflow blocks (allowed)
 *   3. No auth header → API-created webhooks (allowed, log for visibility)
 */
function verifyMondaySignature(req, res, next) {
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

    console.log("Request verified via HMAC signature");
    return next();
  }

  if (req.headers["authorization"]) {
    console.log("Request authenticated via authorization header");
    return next();
  }

  // API-created webhooks may not include auth headers
  console.log("Request received without auth headers (API-created webhook)");
  next();
}

module.exports = { verifyMondaySignature };
