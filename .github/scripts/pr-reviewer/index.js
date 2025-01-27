const { context } = require("@actions/github");

const prReviewService = require("./services/pr-review-service");

module.exports = {
  reviewPR: (context, options) => prReviewService.reviewPR(context, options),
};
