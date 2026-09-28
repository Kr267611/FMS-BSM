// Rule for every new password (create user, change, reset)
function passwordProblem(password) {
  const p = String(password || "");
  if (p.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "Password must contain letters and numbers";
  return null;
}

module.exports = { passwordProblem };
