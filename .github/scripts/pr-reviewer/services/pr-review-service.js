const config = require("../config");
const clients = require("../clients");
const aiService = require("./ai-service");
const slackService = require("./slack-service");
const securityService = require("./security-review-service");

class PRReviewService {
  constructor() {
    this.context = null;
  }

  async reviewPR(context, options = {}) {
    this.context = context;
    const {
      prNumber = context?.payload?.pull_request?.number,
      mainPrompt = require("../prompts/review"),
      priorityPrompt = require("../prompts/priority"),
      model = config.OPENAI.REVIEW.defaultModel,
    } = options;

    if (!prNumber) throw new Error("PR number is required");

    try {
      const pullRequest = await this.getPullRequest(prNumber);
      if (this.shouldSkipReview(pullRequest.title)) {
        return { status: "skipped", reason: "Production deploy or release PR" };
      }

      /// check for duplicate reviews in slack
      const reviewHeader = `Reviewing <${pullRequest.html_url}|${pullRequest.title}>`;

      const isDuplicate = await slackService.checkDuplicateReview(reviewHeader);

      if (isDuplicate) {
        return { status: "skipped", reason: "Review already exists" };
      }

      if (this.shouldSkipReview(pullRequest.title)) {
        return { status: "skipped", reason: "Production deploy or release PR" };
      }

      const review = await this.performReview(pullRequest, mainPrompt, model);

      const priorityModel = config.OPENAI.PRIORITY.defaultModel;
      const priority = await aiService.getPriority(
        review,
        priorityPrompt,
        priorityModel,
      );

      const slackResult = (await slackService.notifyChannel({
        review,
        priority,
        pullRequest,
      })) || { success: false };

      if (priority === "high" && slackResult.success) {
        await securityService.createReview(
          review,
          slackResult.threadUrl,
          prNumber,
        );
      }

      return {
        status: "success",
        priority,
        slackThreadUrl: slackResult?.threadUrl,
      };
    } catch (error) {
      console.error("PR review error:", error);
      return { status: "error", error: error.message };
    }
  }

  async getPullRequest(prNumber) {
    const octokit = await clients.initOctokit();
    const { data } = await octokit.rest.pulls.get({
      owner: this.context?.repo?.owner || clients.getGitHubContext().repo.owner,
      repo: this.context?.repo?.repo || clients.getGitHubContext().repo.repo,
      pull_number: prNumber,
    });
    return data;
  }

  async getChangedFiles(prNumber) {
    const octokit = await clients.initOctokit();
    const { data } = await octokit.rest.pulls.listFiles({
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      pull_number: prNumber,
    });
    return data.map((file) => ({
      filename: file.filename,
      patch: file.patch,
      changes: file.changes,
    }));
  }

  async getPRComments(prNumber) {
    const octokit = await clients.initOctokit();
    const { data: comments } = await octokit.rest.issues.listComments({
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      issue_number: prNumber,
    });

    return comments.map((comment) => comment.body).join("\n\n");
  }

  shouldSkipReview(title) {
    return /\b(release|production|deploy)\b/i.test(title);
  }

  async performReview(pullRequest, prompt, model) {
    const files = await this.getChangedFiles(pullRequest.number);
    const comments = await this.getPRComments(pullRequest.number);
    const reviewPrompt = this.formatReviewPrompt(
      prompt,
      pullRequest.body,
      files,
      comments,
    );
    const review = await aiService.generateReview(reviewPrompt, model);
    return review;
  }

  formatReviewPrompt(prompt, description, files, comments) {
    const fileChanges = files
      .slice(0, config.MAX_FILES)
      .map((file) => `- ${file.filename}\n${file.patch || file.changes}`)
      .join("\n\n");

    return `
      [PR Context]
      ${description || "No description provided."}

      [CHANGES]
      ${fileChanges}
      
      [COMMENTS]
      ${comments}
     
      ${prompt}
    `;
  }
}

module.exports = new PRReviewService();
