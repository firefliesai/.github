const config = require("../config");
const clients = require("../clients");

class AIService {
  async generateReview(prompt, model) {
    try {
      const response = await clients.openai.chat.completions.create({
        messages: [{ role: "user", content: prompt, store: true }],
        model,
        temperature: config.OPENAI.REVIEW.temperature,
        max_completion_tokens: config.OPENAI.REVIEW.max_completion_tokens,
      });

      console.log("OpenAI Usage:", {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
        cost: this.calculateCost(model, response.usage),
      });

      return response?.choices[0].message.content;
    } catch (error) {
      console.error("Review generation error:", error);
      throw error;
    }
  }

  async getPriority(review, priorityPrompt, model) {
    try {
      const prompt = `${priorityPrompt}\n\n### Review Content\n${review}`;
      const response = await clients.openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model,
        temperature: config.OPENAI.PRIORITY.temperature,
        max_tokens: config.OPENAI.PRIORITY.max_tokens,
      });
      return response?.choices[0].message.content.trim();
    } catch (error) {
      console.error("Priority assessment error:", error);
      return "low";
    }
  }

  calculateCost(model, usage) {
    const rates = {
      o1: {
        input: 0.015,
        input_cached: 0.0075,
        output: 0.06,
      },
      "o1-2024-12-17": {
        input: 0.015,
        input_cached: 0.0075,
        output: 0.06,
      },
      "o1-preview": {
        input: 0.015,
        input_cached: 0.0075,
        output: 0.06,
      },
      "gpt-4-0125-preview": {
        input: 0.01,
        output: 0.03,
      },
      "gpt-3.5-turbo-0125": {
        input: 0.0005,
        output: 0.0015,
      },
    };

    const rate = rates[model] || rates["gpt-4-0125-preview"];
    const inputCost = (usage.prompt_tokens * rate.input) / 1000;
    const outputCost = (usage.completion_tokens * rate.output) / 1000;
    return { inputCost, outputCost, total: inputCost + outputCost };
  }
}

module.exports = new AIService();
