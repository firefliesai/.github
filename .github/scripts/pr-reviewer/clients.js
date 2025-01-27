const { context } = require("@actions/github");
const { OpenAI } = require("openai");
const { WebClient } = require("@slack/web-api");
const core = require("@actions/core");
const fetch = require("node-fetch");

module.exports = {
  openai: new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || core.getInput("OPENAI_API_KEY"),
  }),

  slack: new WebClient(process.env.SLACK_TOKEN || core.getInput("SLACK_TOKEN")),

  async initOctokit() {
    if (!this.octokit) {
      const { Octokit } = await import("@octokit/rest");
      this.octokit = new Octokit({
        auth: process.env.GTP_TOKEN || core.getInput("GTP_TOKEN"),
        request: { fetch },
      });
    }
    return this.octokit;
  },

  getGitHubContext() {
    return context;
  },
};
