const { context } = require("@actions/github");
const core = require("@actions/core");
const { OpenAI } = require("openai");
const slackifyMarkdown = require("slackify-markdown");
const { WebClient } = require("@slack/web-api");
const fetch = require("node-fetch");
const outdent = require("outdent");

let octokit;
const MAX_FILES = 20; // only analyze 20 files for now
const NO_RECOMMENDATION = "NO RECOMMENDATION";
const SLACK_CHANNEL = "C075B3XH9AR"; // #dev-github-security
const SLACK_TEAM_SECURITY_OFFICERS = "<!subteam^S074TSWP9R9|security-officer>"; // security officers team

// Initialize OpenAI and Slack clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || core.getInput("OPENAI_API_KEY"),
});

const slack = new WebClient(
  process.env.SLACK_TOKEN || core.getInput("SLACK_TOKEN"),
);

// Initialize Octokit
const initializeOctokit = async () => {
  if (!octokit) {
    const { Octokit } = await import("@octokit/rest");
    octokit = new Octokit({
      auth: process.env.GTP_TOKEN,
      request: { fetch },
    });
  }
};

// Function to get review prompt for PR description and file changes
const getPromptPRDescriptionAndFiles = (description, files) => {
  const fileChanges = files
    .slice(0, MAX_FILES)
    .map(
      (file) =>
        `- ${String(file.filename)}\n${String(file.patch || file.changes)}`,
    )
    .join("\n\n");

  return outdent`
Please review the following pull request for security vulnerabilities, especially related to authentication, authorization, changes on privacy-related implementations, and sensitive data exposure.
This includes reviewing both the description and the actual changes in the files modified in the pull request.

### Pull Request Description
${description}

### Files Changed and their Diffs:
${fileChanges}

### Review Guidelines
1. **Critical Endpoint Authentication**: Have the file changes made any modifications related to authentication or authorization that could affect critical endpoints or affect users' permissions?
2. **Sensitive Data Exposure**: Do the changes in any of the files potentially expose sensitive data or make the application more vulnerable to attacks?
3. **Recommendation**: If authentication, authorization, or sensitive data concerns are present, recommend a few actions to mitigate the risk; otherwise, state "${NO_RECOMMENDATION}".
  `;
};

// Function to fetch and then review PR file changes
const fetchPRFiles = async (prNumber) => {
  const files = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber,
  });
  return files.data.map((file) => ({
    filename: file.filename,
    patch: file.patch, // contains the actual diff (code changes)
    changes: file.changes, // gives a summary of the number of changes
  }));
};

// Function to notify Slack
const notifySlack = async (data) => {
  try {
    const { review } = data;
    const reviewTitle = "### AI Review";
    const prTemplateFirstHeader = "## What does this PR do?";
    const prTemplateSecondHeader = "## Type of change";

    const {
      title,
      html_url: link,
      body: bodyPR,
    } = context.payload.pull_request;
    const embeddedLink = `<${link}|${title}>`;
    const reviewHeader = `Reviewing ${embeddedLink}`;
    const isDuplicate = await previousReviewExists(reviewHeader);
    if (isDuplicate) {
      console.warn("Review already exists in Slack");
      return false;
    }

    const priority = await getPriority(review);
    const priorityEmoji = getPriorityEmoji(priority);

    const formattedRepoName = `\`${context.repo.owner}/${context.repo.repo}\``;

    const mainPostBody = `${reviewHeader} on ${formattedRepoName}\n*Priority: ${priority} ${priorityEmoji}*`;

    const threadBody = formatSlackMessageResponse(review);
    const summaryOfPR =
      formatSlackMessageResponse(bodyPR)
        .split(prTemplateFirstHeader)?.[1]
        ?.split(prTemplateSecondHeader)[0]
        ?.trim() || "";
    const formattedThreadReply = slackifyMarkdown(
      `${prTemplateFirstHeader}\n${summaryOfPR}\n-------\n${reviewTitle}\n${threadBody}`,
    );

    // Send the Main Post to Slack
    const {
      ok: postOk,
      ts,
      error: postError,
    } = await slack.chat.postMessage({
      channel: SLACK_CHANNEL,
      text: mainPostBody,
    });

    if (!postOk) {
      console.error(`Error posting main review to Slack: ${postError}`);
      return { success: false };
    }

    // Send the Thread Reply to Slack under the Main Post
    const { ok: threadOk, error: threadError } = await slack.chat.postMessage({
      channel: SLACK_CHANNEL,
      text: formattedThreadReply,
      thread_ts: ts,
    });

    if (!threadOk) {
      console.error(`Error posting thread reply to Slack: ${threadError}`);
      return { success: false };
    }

    // Get the permalink to the thread
    const { permalink } = await slack.chat.getPermalink({
      channel: SLACK_CHANNEL,
      message_ts: ts,
    });

    return {
      success: true,
      threadUrl: permalink,
    };
  } catch (e) {
    console.error(`Error notifying Slack: ${e.message}`);
    return { success: false };
  }
};

// Function to get priority prompt
const getPriorityPrompt = (review) => outdent`
Please choose a priority between low, medium and high. The priority should be based on your impact analysis/recommendation based on the likelihood for this PR to cause a security concern. 
Low priority - minor vulnerabilities or concerns that pose little to no immediate risk and can be addressed in future updates. 
Medium priority - Moderate vulnerabilities or concerns that could potentially impact security or functionality and should be addressed in a reasonable timeframe. 
High priority - Critical vulnerabilities or concerns that pose significant immediate risks to security or functionality and require urgent attention and resolution. 
Please share just the priority [low, medium, high] and no additional context.\n\n### Review Content\n${review}`;

// Function to get emoji based on priority
const getPriorityEmoji = (priority) => {
  switch (priority.toLowerCase()) {
    case "high":
      return `:red_circle: ${SLACK_TEAM_SECURITY_OFFICERS} Please Review`; // Red for high priority
    case "medium":
      return ":large_yellow_circle:"; // Yellow for medium priority
    case "low":
      return ":large_green_circle:"; // Green for low priority
    default:
      return ""; // No emoji if priority is not recognized
  }
};

// Main function to review a single PR
const reviewPR = async () => {
  await initializeOctokit();

  const pullRequest = context.payload.pull_request;
  const title = pullRequest.title;
  const descriptionPR = pullRequest.body || "No description provided.";
  const prNumber = pullRequest.number;

  const skipReviewRegex = /\b(release|production|deploy)\b/i;

  if (skipReviewRegex.test(title)) {
    core.info(
      `Skipping review for PR #${prNumber}: '${title}' is marked as a production deploy or release.`,
    );
    return;
  }

  try {
    const filesChanged = await fetchPRFiles(prNumber);
    const promptPRDescription = getPromptPRDescriptionAndFiles(
      descriptionPR,
      filesChanged,
    );

    // Generate review from OpenAI
    const review = (
      await openai.chat.completions.create({
        messages: [{ role: "user", content: promptPRDescription }],
        model: "gpt-4o",
        temperature: 0.6,
        max_tokens: 2048,
      })
    )?.choices[0].message.content;

    if (!review?.includes(NO_RECOMMENDATION)) {
      // Get priority level
      const priority = await getPriority(review);

      // Send to Slack and get thread URL
      const { success, threadUrl } = await notifySlack({
        review,
      });

      // If priority is high, add a comment to the PR with Slack thread link
      if (priority.toLowerCase() === "high" && success && threadUrl) {
        await createSecurityReview(review, threadUrl);
      }

      core.info(`Reviewed PR #${prNumber} successfully.`);
    } else {
      core.info(
        `PR #${prNumber} reviewed: No changes related to authentication or authorization.`,
      );
    }
  } catch (e) {
    console.error(`Error reviewing PR: ${e.message}`);
  }
};

// Helper function to get priority
const getPriority = async (review) => {
  try {
    const response = await openai.chat.completions.create({
      messages: [{ role: "user", content: getPriorityPrompt(review) }],
      model: "gpt-4o-mini",
      temperature: 0.0,
      max_tokens: 20,
    });
    return response?.choices[0].message.content.trim();
  } catch (e) {
    console.error("Error getting priority from OpenAI:", e);
    return "low"; // Default to low priority if error occurs
  }
};

// Helper function to format thread body
const formatSlackMessageResponse = (body) => {
  // Remove whitespace between line break and bullet
  return body
    .replace(/\n\s+-/g, "\n-")
    .replace(/\* (.+) (by .+) in (https:\/\/.+)(\n)*/g, "* [$1]($3) $2$4");
};

const previousReviewExists = async (reviewMessage) => {
  try {
    // Fetch the last 20 messages from the Slack channel
    const result = await slack.conversations.history({
      channel: SLACK_CHANNEL,
      limit: 20,
    });

    const messages = result.messages;

    // Check if the review message already exists
    const messageExists = messages.some((message) =>
      message.text.includes(reviewMessage),
    );
    return messageExists;
  } catch (error) {
    console.error("Error checking or posting review message:", error);
    return false;
  }
};

const createSecurityReview = async (review, slackThreadUrl) => {
  try {
    const pullRequest = context.payload.pull_request;
    const prNumber = pullRequest.number;

    // Format the review comment
    const reviewComment = outdent`
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

⚠️   **Important:** This PR should not be merged until all security concerns have been properly addressed and verified. Your team's security is our top priority.
    `;

    // Create PR comment instead of review
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: reviewComment,
    });

    // Add a label to the PR
    await octokit.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      labels: ["security-review-required"],
    });

    core.info(`Created security review comment for PR #${prNumber}`);
    return true;
  } catch (e) {
    console.error(`Error creating security review comment: ${e.message}`);
    return false;
  }
};

module.exports = { reviewPR };
