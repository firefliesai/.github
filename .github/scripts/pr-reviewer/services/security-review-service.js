const outdent = require("outdent");
const { context } = require("@actions/github");
const core = require("@actions/core");
const clients = require("../clients");

class SecurityReviewService {
  async createReview(context, review, slackThreadUrl, prNumber) {
    this.context = context;

    const octokit = await clients.initOctokit();

    await this.createComment(octokit, review, slackThreadUrl, prNumber);
    await this.addSecurityLabel(octokit, prNumber);

    core.info(`Created security review for PR #${prNumber}`);
  }

  async createComment(octokit, review, slackThreadUrl, prNumber) {
    await octokit.rest.issues.createComment({
      owner: this.context?.repo?.owner || clients.getGitHubContext().repo.owner,
      repo: this.context?.repo?.repo || clients.getGitHubContext().repo.repo,
      issue_number: prNumber,
      body: this.formatReview(review, slackThreadUrl),
    });
  }

  async addSecurityLabel(octokit, prNumber) {
    try {
      const { data: labels } = await octokit.rest.issues.listLabelsForRepo({
        owner:
          this.context?.repo?.owner || clients.getGitHubContext().repo.owner,
        repo: this.context?.repo?.repo || clients.getGitHubContext().repo.repo,
      });

      const labelExists = labels.some(
        (label) => label.name === "security-review-required",
      );
      if (!labelExists) {
        await octokit.rest.issues.createLabel({
          owner: this.context.repo.owner,
          repo: this.context.repo.repo,
          name: "security-review-required",
          color: "d73a4a",
          description: "Requires security review before merge",
        });
      }

      await octokit.rest.issues.addLabels({
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
        issue_number: prNumber,
        labels: ["security-review-required"],
      });
    } catch (error) {
      core.error(`Failed to add security label: ${error.message}`);
      throw error;
    }
  }

  formatReview(review, slackThreadUrl) {
    return outdent`
      🚨 **High Priority Security Concerns Detected**

      Our automated security review has identified critical concerns that should be addressed in this PR.

      ### Security Review Findings
      <details>
      <summary>Security Review Details</summary>
      ${review}
      </details>

      ### Required Actions
      1. Review the security findings detailed above ⚠️
      2. Implement necessary changes to address the identified security concerns
      3. Join the [Security Review Thread](${slackThreadUrl}) to:
        - Provide context about these security findings
        - Discuss your planned fixes
        - Get additional guidance if needed

      ⚠️ **Important:** This PR should not be merged until all security concerns have been properly addressed and verified.
    `;
  }
}

module.exports = new SecurityReviewService();
