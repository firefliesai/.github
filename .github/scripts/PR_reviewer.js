const path = require('node:path');
const { getPromptPRDescription } = require(path.join(__dirname, '..', 'prompts'));

module.exports = {
	reviewPR: async ({ openai, octokit, slack, format, context }) => {
		console.log('Reviewing PR...');
		const pullRequest = context.payload.pull_request.number;
		const title = context.payload.pull_request.title;
		const descriptionPR = context.payload.pull_request.body;
		const link = context.payload.pull_request.html_url;
		const promptPRDescription = getPromptPRDescription(descriptionPR);
		const reviewTitle = '### Authentication and Authorization';
		const sectionTitle = '## What does this PR do?';
		const repoOwner = context.payload.organization.login;
		const repoName = context.payload.repository.name;
		const commentPR =  async (issueId, comment) => {
			try {
				const commentRes = await octokit.rest.issues.createComment({
					owner: repoOwner,
					repo: repoName,
					issue_number: issueId,
					body: comment,
				});
				return !!commentRes;
			} catch (e) {
				console.error('Error commenting on PR:', e);
				return false;
			}
		};
		const notifySlack = async (slack, bodyPR, reviewPR) => {
			try {
				let body = bodyPR + reviewPR;
				console.info('original body:', JSON.stringify(body));
				body = body.replaceAll(/\n\s+-/g, '\n-'); // Remove white space between line break and bullet
				body = body.replaceAll(/\* (.+) (by .+) in (https:\/\/.+)(\n)*/g, '* [$1]($3) $2$4'); // Convert PR title to hyperlink
				const summary = body.split(sectionTitle)?.[1]?.split('## Type of change')[0];
				const review = body.split(reviewTitle)?.[1]; // Split review from PR description
				body = `
Reviewing [${title}](${link}) on \`${repoOwner}/${repoName}\`
${sectionTitle}
${summary.trim()}

${reviewTitle}
${review.trim()}
`;
				body = format(body);
				body = body.replaceAll('\\r\\n', '');
				console.info('body to send to Slack:', body);
				
				const slackChannel = 'C075B3XH9AR'; // #dev-github-security
				const { ok, error } = await slack.chat.postMessage({
					channel: slackChannel,
					text: body
				})
				if (error) {
					console.error('Error notifying slack:', error);
				}
				return !!ok;
			} catch (e) {
				console.error('Error notifying slack:', e);
				return false;
			}
		};
		const noDescriptionBody = `${reviewTitle}\n**No PR description provided**: Please provide a description for the PR.\n`;
		
		if (!promptPRDescription) {
			await commentPR(pullRequest, noDescriptionBody);
			return;
		}
		
		if (promptPRDescription.includes('What does this PR do?') && promptPRDescription.includes('Type of change')) {
			const description = promptPRDescription.split('What does this PR do?')[1].split('## Type of change')[0].trim();
			if (!description || description.includes('xxx')) {
				await commentPR(pullRequest, noDescriptionBody);
				return;
			}
		}
		
		try {
			const reviewDescription = (await openai.chat.completions.create({
				messages: [{ role: 'user', content: promptPRDescription }],
				model: 'gpt-4o',
				temperature: 0.6,
				max_tokens: 2048,
			}))?.choices[0].message.content;
			const review = `${reviewTitle}\n${reviewDescription}`;
			await commentPR(pullRequest, review);
			if (!review.includes('The description does not mention any changes related to authentication or authorization')) {
				await notifySlack(slack, descriptionPR, review);
			}
		} catch (e) {
			console.error('Error generating description review:', e);
			await commentPR(pullRequest, `${reviewTitle}\n**Error**: OpenAI error when reviewing the PR description.\n`);
		}
	}
};