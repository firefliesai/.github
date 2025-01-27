const slackifyMarkdown = require("slackify-markdown");
const config = require("../config");
const clients = require("../clients");

class SlackService {
  async checkDuplicateReview(reviewHeader) {
    try {
      const result = await clients.slack.conversations.history({
        channel: config.SLACK.CHANNEL,
        limit: 20,
      });

      return result.messages.some((message) =>
        message.text.includes(reviewHeader),
      );
    } catch (error) {
      console.error("Error checking for duplicate review:", error);
      return false;
    }
  }

  async notifyChannel(data) {
    const { review, priority, pullRequest } = data;
    const messageData = this.formatMessages(review, priority, pullRequest);

    const mainPost = await this.sendMessage(messageData.main);
    if (!mainPost.ok) return { success: false };

    const threadReply = await this.sendMessage({
      ...messageData.thread,
      thread_ts: mainPost.ts,
    });
    if (!threadReply.ok) return { success: false };

    const permalink = await this.getThreadPermalink(mainPost.ts);
    return { success: true, threadUrl: permalink };
  }

  async sendMessage(messageData) {
    return clients.slack.chat.postMessage({
      channel: config.SLACK.CHANNEL,
      ...messageData,
    });
  }

  async getThreadPermalink(timestamp) {
    return clients.slack.chat.getPermalink({
      channel: config.SLACK.CHANNEL,
      message_ts: timestamp,
    });
  }

  formatMessages(review, priority, pullRequest) {
    const { title, html_url, body } = pullRequest;
    const reviewHeader = `Reviewing <${html_url}|${title}>`;
    const priorityEmoji = this.getPriorityEmoji(priority);

    return {
      main: {
        text: `${reviewHeader}\n*Priority: ${priority} ${priorityEmoji}*`,
      },
      thread: {
        text: this.formatThreadReply(review, body),
      },
    };
  }

  formatThreadReply(review, prBody) {
    const sections = {
      title: "### AI Review",
      prHeader: "## What does this PR do?",
      typeHeader: "## Type of change",
    };

    const summary = this.extractPRSummary(prBody, sections);
    // Use proper markdown formatting
    return slackifyMarkdown(
      `${sections.prHeader}\n\n${summary}\n\n---\n\n${sections.title}\n\n${this.formatMessageResponse(review)}`,
    );
  }

  extractPRSummary(body, sections) {
    return body
      ? this.formatMessageResponse(body)
          .split(sections.prHeader)[1]
          ?.split(sections.typeHeader)[0]
          ?.trim()
      : "";
  }

  getPriorityEmoji(priority) {
    const emojis = {
      high: `:red_circle: ${config.SLACK.SECURITY_TEAM} Please Review`,
      medium: ":large_yellow_circle:",
      low: ":large_green_circle:",
    };
    return emojis[priority.toLowerCase()] || "";
  }

  formatMessageResponse(text) {
    if (!text) return "";

    // Proper handling of bullet points and multiline text
    return text
      .replace(/\n\s*•\s*/g, "\n• ") // Standardize bullet points
      .replace(/\n\s*\*\s*/g, "\n• ") // Convert asterisks to bullet points
      .replace(/\n{3,}/g, "\n\n") // Reduce multiple newlines
      .replace(/\n\s+-/g, "\n-") // Clean up dashes
      .trim();
  }
}

module.exports = new SlackService();
