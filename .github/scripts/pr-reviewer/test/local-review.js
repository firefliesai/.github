require("dotenv").config();
const { reviewPR } = require("../index");

async function runLocalReview() {
  const prNumber = process.argv[2];
  if (!prNumber) {
    console.error("Please provide PR number: npm run review <pr-number>");
    process.exit(1);
  }

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    console.error("GITHUB_OWNER and GITHUB_REPO must be set in .env");
    process.exit(1);
  }

  try {
    const result = await reviewPR({
      repo: { owner, repo },
      payload: { pull_request: { number: parseInt(prNumber) } },
    });
    console.log("Review Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Review failed:", error);
    process.exit(1);
  }
}

runLocalReview();
