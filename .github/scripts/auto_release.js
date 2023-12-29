const getCommitPullRequest = async ({ github, context, message }) => {
	const prNumber = message.replace(/^.*\(#(\d+)\)(.|\n|\r)*$/, '$1'); // Extract commit pr number

	const { data: pullRequest } = await github.rest.pulls.get({
		...context.repo,
		pull_number: Number(prNumber),
	});

	if (!pullRequest) return;
	if (!pullRequest.title.includes('Deploy to production')) {
		return {
			body: pullRequest.body,
			title: pullRequest.title,
			number: pullRequest.number,
			author: pullRequest.user.login
		}
	}
}

const getReleaseActions = ({ isFeature, isBugFix, isBreaking }) => {
	const changes = [];
	isBugFix && changes.push('- Bug Fix');
	isFeature && changes.push('- New Feature');
	isBreaking && changes.push('- Breaking Change');
	return changes;
}

module.exports = {
	checkMergeCommit: async ({ github, context }) => {
		const { data: pushCommit } = await github.rest.git.getCommit({
			...context.repo,
			commit_sha: context.sha
		});

		return pushCommit.parents.length < 2;
	},
	createDeploymentPR: async ({ github, context }) => {
		const { data: prs } = await github.rest.pulls.list({
			...context.repo,
			state: 'open',
			base: context.payload.inputs.main_branch,
			sort: 'created',
			direction: 'desc'
		});

		const hasDeployPR = prs?.some?.(pr => pr.title === 'Deploy to production');
		if (!hasDeployPR) {
			const body = `
## What does this PR do?
Computing summaries of merged PRs...
`;
			await github.rest.pulls.create({
				...context.repo,
				base: context.payload.inputs.main_branch,
				head: context.payload.inputs.staging_branch,
				title: 'Deploy to production',
				body
			});
		}

		return !hasDeployPR;
	},
	generateSummaries: async ({ github, context, core }) => {
		const allPullRequests = {};

		const { data: prs } = await github.rest.pulls.list({
			...context.repo,
			state: 'open',
			base: context.payload.inputs.main_branch,
			sort: 'created',
			direction: 'desc'
		});

		const hasDeployPR = prs?.some?.(pr => pr.title === 'Deploy to production');
		if (!hasDeployPR) return;

		const deployPR = prs[0];

		const commits = await github.paginate(
			github.rest.pulls.listCommits, {
			...context.repo,
			per_page: 100,
			pull_number: deployPR.number
		});

		await Promise.allSettled(
			commits.map(async ({ commit }) => {
				const { message } = commit;

				if (/(\(#\d+\)|Merge pull request #\d+)/gm.test(message)) {
					const pullRequest = await getCommitPullRequest({ github, context, message });
					if (pullRequest) allPullRequests[pullRequest.number] = pullRequest;
				}

				return;
			})
		);

		console.info('all', allPullRequests);

		let isBugFix = false;
		let isFeature = false;
		let isBreaking = false;
		let body = `
## Release Pull Requests`;

		body = Object.keys(allPullRequests).reduce((draft, number) => {
			const pullRequest = allPullRequests[number];
			const message = `#${pullRequest.number} by @${pullRequest.author}`;
			draft += `
- ${message}`;

			return draft;
		}, body);

		body += `

## Release Summary`;

		body = Object.keys(allPullRequests).reduce((draft, number) => {
			const pullRequest = allPullRequests[number];
			console.info(JSON.stringify(pullRequest.body));

			let message = pullRequest.body.split('What does this PR do?')[1]?.split('#')[0]?.trim(); // Extract the PR summaries from the description body
			if (!message) return draft;

			isBugFix ||= /\[x\] Bugfix/gm.test(pullRequest.body)
			isFeature ||= /\[x\] Feature/gm.test(pullRequest.body)
			isBreaking ||= /\[x\] Breaking changes/gm.test(pullRequest.body)

			if (!/^\s*-/.test(message)) {
				message = `- ${message}`;
			}

			message = message.replace(/\d+-/g, '-'); // Replace all number points with bullet points
			message = message.replaceAll(/(\n|\r)+/g, ' '); // Remove all unintentional line breaks between words
			message = message.replaceAll(/- /g, '\n- ').trim(); // Put all bullet points on a new line

			draft += `
${message}`;

			return draft;
		}, body);

		const releaseActions = getReleaseActions({ isFeature, isBugFix, isBreaking });

		if (releaseActions.length) {
			body += `

## Release Actions
${releaseActions.join('\n')}
`;
		}

		core.notice(body);

		await github.rest.pulls.update({
			...context.repo,
			pull_number: deployPR.number,
			body
		})
	}
}