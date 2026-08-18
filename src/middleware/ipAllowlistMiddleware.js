/**
 * Restricts a route to a fixed set of trusted internal IPs (comma-separated in
 * PRIVATE_API_ALLOWED_IPS) instead of requiring a JWT - for internal service-to-service
 * calls (e.g. another internal webserver sharing this database) where there's no
 * human user/login involved. No reverse proxy sits in front of this app (app.js
 * never sets 'trust proxy'), so req.ip reflects the real TCP peer address and can't
 * be spoofed via X-Forwarded-For.
 */
const ipAllowlist = (req, res, next) => {
  const allowedIps = (process.env.PRIVATE_API_ALLOWED_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean);

  // Normalize IPv4-mapped IPv6 form (e.g. "::ffff:172.21.5.253") down to plain IPv4
  const clientIp = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');

  if (allowedIps.includes(clientIp)) {
    return next();
  }

  console.warn(`[PrivateAPI] Rejected request from unauthorized IP: ${clientIp}`);
  return res.status(403).json({
    success: false,
    message: 'Access denied: this endpoint is only accessible from authorized internal IPs'
  });
};

module.exports = ipAllowlist;
