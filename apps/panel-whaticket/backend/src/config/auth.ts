const secret = process.env.JWT_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;

if (!secret || secret.length < 32) {
  throw new Error(
    "JWT_SECRET env var is required and must be at least 32 characters. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
  );
}
if (!refreshSecret || refreshSecret.length < 32) {
  throw new Error(
    "JWT_REFRESH_SECRET env var is required and must be at least 32 characters."
  );
}

export default {
  secret,
  expiresIn: "15m",
  refreshSecret,
  refreshExpiresIn: "7d"
};
