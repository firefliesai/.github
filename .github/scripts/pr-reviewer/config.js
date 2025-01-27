module.exports = {
  MAX_FILES: 20,
  NO_RECOMMENDATION: "NO_RECOMMENDATION",
  SLACK: {
    CHANNEL: process.env.SLACK_CHANNEL_GIT_SECURITY || "C075B3XH9AR",
    SECURITY_TEAM: "<!subteam^S074TSWP9R9|security-officer>",
  },
  OPENAI: {
    REVIEW: {
      temperature: 1,
      max_completion_tokens: 2048,
      defaultModel: "o1-mini",
    },
    PRIORITY: {
      defaultModel: "gpt-4",
      temperature: 0.3,
      max_tokens: 20,
    },
  },
};
