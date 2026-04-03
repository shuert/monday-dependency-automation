const crypto = require("crypto");
const jwt = require("jsonwebtoken");

/**
 * Verifies incoming webhook / integration requests.
 *
 * 1. x-monday-signature → HMAC-SHA256 of raw body (classic webhooks)
 * 2. Authorization JWT → verified with MONDAY_SIGNING_SECRET; sets req.mondayJwt (integration actions)
 * 3. No auth → API-created webhooks (change_column_value) without signature
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

  const authHeader = req.headers["authorization"];
  if (authHeader) {
    const signingSecret = process.env.MONDAY_SIGNING_SECRET;
    if (!signingSecret) {
      console.error("MONDAY_SIGNING_SECRET is not set");
      return res.status(500).json({ error: "Server misconfiguration" });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    try {
      const decoded = jwt.verify(token, signingSecret);
      req.mondayJwt = decoded;
      console.log("Request verified via monday integration JWT");
      return next();
    } catch (err) {
      console.warn("Invalid integration JWT:", err.message);
      return res.status(401).json({ error: "Invalid authorization token" });
    }
  }

  console.log("Request received without auth headers (API-created webhook)");
  next();
}

module.exports = { verifyMondaySignature };
