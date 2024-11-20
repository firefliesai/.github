const core = require("@actions/core");
const { context } = require("@actions/github");
const github = require("@actions/github");

async function run() {
  try {
    const token = process.env.GTP_TOKEN;
    const repoName = process.env.REPO_NAME;

    if (!token) {
      core.setFailed("GTP_TOKEN is not available.");
      return;
    }

    if (!repoName) {
      core.setFailed("Repository name is not provided.");
      return;
    }

    const octokit = github.getOctokit(token);

    const { data: repoData } = await octokit.rest.repos.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    const defaultBranch = repoData.default_branch;

    const branchProtectionConfig = {
      owner,
      repo,
      branch: defaultBranch,
      required_status_checks: {
        strict: true,
        contexts: [],
      },
      enforce_admins: true,
      required_pull_request_reviews: {
        required_approving_review_count: 1,
      },
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false,
    };

    await octokit.rest.repos.updateBranchProtection(branchProtectionConfig);

    console.log(
      `Branch protection rules set for ${owner}/${repo} on branch ${defaultBranch}.`,
    );
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

run();
