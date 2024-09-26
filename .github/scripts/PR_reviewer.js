const { context } = require('@actions/github');
const core = require('@actions/core');
const { OpenAI } = require('openai');
const format = require('slackify-markdown');
const { WebClient } = require('@slack/web-api');
const fetch = require('node-fetch');

let octokit;

// Initialize OpenAI and Slack clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || core.getInput('OPENAI_API_KEY'),
});

const slack = new WebClient(core.getInput('SLACK_TOKEN'));

// Initialize Octokit
const initializeOctokit = async () => {
  if (!octokit) {
    const { Octokit } = await import('@octokit/rest');
    octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN || core.getInput('GITHUB_TOKEN'),
      request: { fetch },
    });
  }
};

// Function to get review prompt for PR description and file changes
const getPromptPRDescriptionAndFiles = (description, files) => {
  const fileChanges = files.map(file => `- ${file.filename}\n${file.patch || file.changes}`).join('\n\n');

  return `
Please review the following pull request for security vulnerabilities, especially related to authentication, authorization, and sensitive data exposure.
This includes reviewing both the description and the actual changes in the files modified in the pull request.

### Pull Request Description
${description}

### Files Changed and their Diffs:
${fileChanges}

### Review Guidelines
1. **Critical Endpoint Authentication**: Have the file changes made any modifications related to authentication or authorization that could affect critical endpoints or affect users' permissions?
2. **Sensitive Data Exposure**: Do the changes in any of the files potentially expose sensitive data or make the application more vulnerable to attacks?
3. **Recommendation**: If authentication, authorization, or sensitive data concerns are present, recommend a few actions to mitigate the risk; otherwise, state "No recommendations".
  `;
};

// Function to comment on a PR
const commentPR = async (issueId, comment) => {
  try {
    const commentRes = await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueId,
      body: comment,
    });
    return !!commentRes;
  } catch (e) {
    console.error(`Error commenting on PR: ${e.message}`);
    return false;
  }
};

// Function to fetch and then review PR file changes
const fetchPRFiles = async (prNumber) => {
  const files = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber,
  });
  return files.data.map(file => ({
    filename: file.filename,
    patch: file.patch, // contains the actual diff (code changes)
    changes: file.changes, // gives a summary of the number of changes
  }));
};

// Function to notify Slack
const notifySlack = async (data) => {
  try {
    const { sectionTitle, reviewTitle, reviewPR, format } = data;

    const title = context.payload.pull_request.title;
    const link = context.payload.pull_request.html_url;
    const bodyPR = context.payload.pull_request.body;

    // Determine priority dynamically using OpenAI
    const priorityResponse = await openai.chat.completions.create({
      messages: [{ role: 'user', content: getPriorityPrompt(reviewPR) }],
      model: 'gpt-4o-mini',
      temperature: 0.0,
      max_tokens: 20,
    });
    const priority = priorityResponse?.choices[0].message.content.trim();
    const priorityEmoji = getPriorityEmoji(priority);

    // Create embedded hyperlink for Slack message
    const embeddedLink = `<${link}|${title}>`;

    // Format repository name in code style
    const formattedRepoName = `\`${context.repo.owner}/${context.repo.repo}\``;

    // Main Post Body with Priority and Emoji
    const mainPostBody = `Reviewing ${embeddedLink} on ${formattedRepoName}\n*Priority: ${priority} ${priorityEmoji}*`;

    // Thread Reply Body
    let threadBody = bodyPR + reviewPR;
    threadBody = threadBody.replace(/\n\s+-/g, '\n-'); // Remove whitespace between line break and bullet
    threadBody = threadBody.replace(/\* (.+) (by .+) in (https:\/\/.+)(\n)*/g, '* [$1]($3) $2$4');

    const summary = threadBody.split(sectionTitle)?.[1]?.split('## Type of change')[0]?.trim() || '';
    const review = threadBody.split(reviewTitle)?.[1]?.trim() || '';

    const formattedThreadReply = format(`${sectionTitle}\n${summary}\n\n${reviewTitle}\n${review}`);

    // Send the Main Post to Slack
    const { ok: postOk, ts, error: postError } = await slack.chat.postMessage({
      channel: 'C075B3XH9AR', // #dev-github-security
      text: mainPostBody,
    });

    if (!postOk) {
      console.error(`Error posting main review to Slack: ${postError}`);
      return false;
    }

    // Send the Thread Reply to Slack under the Main Post
    const { ok: threadOk, error: threadError } = await slack.chat.postMessage({
      channel: 'C075B3XH9AR', // #dev-github-security
      text: formattedThreadReply,
      thread_ts: ts,
    });

    if (!threadOk) {
      console.error(`Error posting thread reply to Slack: ${threadError}`);
      return false;
    }

    return true;
  } catch (e) {
    console.error(`Error notifying Slack: ${e.message}`);
    return false;
  }
};

// Function to get priority prompt
const getPriorityPrompt = (review) => `
Please choose a priority between low, medium and high. The priority should be based on your impact analysis/recommendation based on the likelihood for this PR to cause a security concern. 
Low priority - minor vulnerabilities or concerns that pose little to no immediate risk and can be addressed in future updates. 
Medium priority - Moderate vulnerabilities or concerns that could potentially impact security or functionality and should be addressed in a reasonable timeframe. 
High priority - Critical vulnerabilities or concerns that pose significant immediate risks to security or functionality and require urgent attention and resolution. 
Please share just the priority [low, medium, high] and no additional context.\n\n### Review Content\n${review}`;

// Function to get emoji based on priority
const getPriorityEmoji = (priority) => {
  switch (priority.toLowerCase()) {
    case 'high':
      return ':red_circle:';  // Red for high priority
    case 'medium':
      return ':yellow_circle:';  // Yellow for medium priority
    case 'low':
      return ':green_circle:';  // Green for low priority
    default:
      return '';  // No emoji if priority is not recognized
  }
};

// Main function to review a single PR
const reviewPR = async () => {
  await initializeOctokit();

  const pullRequest = context.payload.pull_request;
  const descriptionPR = pullRequest.body || 'No description provided.';
  const prNumber = pullRequest.number;

  try {
    const filesChanged = await fetchPRFiles(prNumber);

    const promptPRDescription = getPromptPRDescriptionAndFiles(descriptionPR, filesChanged);
    const reviewTitle = '### Authentication and Authorization';
    const sectionTitle = '## What does this PR do?';
    const noDescriptionBody = `${reviewTitle}\n**No PR description provided**: Please provide a description for the PR.\n`;

    if (!descriptionPR || descriptionPR.includes('xxx')) {
      core.info('Skipping PR without a proper description.');
      return;
    }

    // Generate review from OpenAI
    const reviewDescription = (await openai.chat.completions.create({
      messages: [{ role: 'user', content: promptPRDescription }],
      model: 'gpt-4o-mini',
      temperature: 0.6,
      max_tokens: 2048,
    }))?.choices[0].message.content;

    const review = `${reviewTitle}\n${reviewDescription}`;
    if (!review.includes('The description does not mention any changes related to authentication or authorization')) {
      await commentPR(prNumber, review);
      await notifySlack({
        sectionTitle,
        reviewTitle,
        reviewPR: review,
        format,
      });
      core.info(`Reviewed PR #${prNumber} successfully.`);
    } else {
      core.info(`PR #${prNumber} reviewed: No changes related to authentication or authorization.`);
    }
  } catch (e) {
    console.error(`Error reviewing PR: ${e.message}`);
  }
};

module.exports = { reviewPR };