const getCommitPullRequest = async ({ github, context, message }) => {
	let prNumber = message.replace(/^.*\(#(\d+)\)(.|\n|\r)*$/, '$1'); // Extract commit pr number

	if (/\D+/.test(prNumber)) {
		prNumber = prNumber.replace(/^(.|\n|\r)* #(\d+) (.|\n|\r)+$/, '$2'); // Extract commit pr number
	}

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
		const prRegex = /\(#\d+\)/g;
		const { data: pushCommit } = await github.rest.git.getCommit({
			...context.repo,
			commit_sha: context.sha
		});

		return pushCommit.parents.length < 2 && !prRegex.test(pushCommit.message);
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

			let message = pullRequest.body.split('What does this PR do?')[1]?.split('#')[0]?.trim(); // Extract the PR summaries from the description body
			if (!message) {
				message = pullRequest.title;
			}

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


		/** Start: experiment new Release Summary */
		body += `

## Experimental Release Summary`;
		body = Object.keys(allPullRequests).reduce((draft, number) => {
			const pullRequest = allPullRequests[number];
			let message = pullRequest.body.split('What does this PR do?')[1]?.split('#')[0]?.trim(); // Extract the PR summaries from the description body
			const summaryItem = processString(message, pullRequest.title)
			draft += `
			${summaryItem}`;
		}, body);
		/** End: experiment new Release Summary */

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


/** used by Experimental Release Summary */
const processString = (bodyStr, titleStr) => {
	// Case 2: If bodyStr length is less than or equal to 5, return titleStr
	if (bodyStr.length <= 5) {
	  return titleStr;
	}
  
	// Case 3: Check if bodyStr matches the list pattern (bullet or numbered)
	// This regex matches any content before the list, and then the list itself
	// '^([\s\S]*?)' matches any characters (including newlines) up to the start of the list
	// '^((?:[-\d*+]\.?\s+.*(?:\n|$))+)' matches the list items
	// 'm' flag enables multiline mode, allowing '^' to match the start of each line
	const listPattern = /^([\s\S]*?)^((?:[-\d*+]\.?\s+.*(?:\n|$))+)/m;
	const listMatch = bodyStr.match(listPattern);
  
	if (listMatch) {
	  let [, preListContent, list] = listMatch;
	  let firstWords = preListContent.trim();
	  
	  // If there are no words before the list, use titleStr
	  // This ensures we always have a title for the list
	  if (!firstWords) {
		firstWords = titleStr;
	  }
	  
	  // Process the list, adding proper indentation
	  const indentedList = list
		.trim()
		.split('\n')
		.map(line => line.trim())
		.map(line => {
		  if (line.match(/^\d+\./)) {
			// For numbered lists, add two spaces at the beginning and two spaces after the period
			return `  ${line.replace(/^(\d+\.)/, '$1  ')}`;
		  } else {
			// For bullet lists, add two spaces at the beginning
			return `  ${line}`;
		  }
		})
		.join('\n');
	  
	  // Note: Any text after the list is implicitly removed here,
	  // as we only process the matched list items  
	  return `\n- ${firstWords}\n${indentedList}`;
	}
  
	// Case 4: If bodyStr is multi-paragraph text
	if (bodyStr.includes('\n\n')) {
	  const paragraphs = bodyStr.split('\n\n');
	  const formattedParagraphs = paragraphs.map(p => `  - ${p.trim()}`).join('\n');
	  return `\n- ${titleStr}\n${formattedParagraphs}`;
	}
  
	// Case 1: Default case for simple strings
	return `\n- ${bodyStr}`;
  };

/** Start: test processString */
const bodyStrArray = [
	'Short',
	'This is a simple string.',
	'First line.\n- Bullet 1\n- Bullet 2\nLast line.',
	'Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.',
	'\n- Bullet 1\n- Bullet 2\n- Bullet 3',
	'Some words\n1. Number 1\n2. Number 2\n3. Number 3',
];
const titleStrArray = [
  'Title 1',
  'Title 2',
  'Title 3',
  'Title 4',
  'Title 5',
  'Title 6',
];
const mapReduce = (bodyStrArray, titleStrArray) => {
  return bodyStrArray.reduce(
	(result, bodyStr, index) =>
	result + processString(bodyStr, titleStrArray[index]),
	'',
  );
};  
// const result = mapReduce(bodyStrArray, titleStrArray);
// expected: "Title 1\n- This is a simple string.\n- First line.\n  - Bullet 1\n  - Bullet 2\n- Title 4\n  - Paragraph 1.\n  - Paragraph 2.\n  - Paragraph 3.\n- Title 5\n  - Bullet 1\n  - Bullet 2\n  - Bullet 3\n- Some words\n  1.   Number 1\n  2.   Number 2\n  3.   Number 3"
// console.debug(result);
  