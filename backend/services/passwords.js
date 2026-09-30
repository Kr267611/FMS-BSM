// Rule for every new password (create user, change, reset). Kept short on purpose: the admin hands out
// simple passwords; brute force is stopped by the lock after 5 wrong tries and the sign-in rate limit.
const MIN_LENGTH = 4;
function passwordProblem(password) {
  const p = String(password || "");
  if (p.trim().length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  return null;
}

module.exports = { passwordProblem };
