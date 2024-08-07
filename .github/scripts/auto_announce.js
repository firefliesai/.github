const computeReleaseName = ({ name, isFeature, isBreaking }) => {
	const version = name.replace(/v\.?/, '').split('.');

	if (isBreaking) {
		version[0] = Number(version[0]) + 1;
		version[1] = 0;
		version[2] = 0;
	} else if (isFeature) {
		version[1] = Number(version[1]) + 1;
		version[2] = 0;
	} else {
		version[2] = Number(version[2]) + 1;
	}

	return `v${version.join('.')}`;
}

const getCommitPullRequestBody = async ({ github, context, message }) => {
	const prNumber = message.replace(/^Merge pull request #(\d+) (.|\n|\r)+$/, '$1'); // Extract commit pr number

	const { data: pullRequest } = await github.rest.pulls.get({
		...context.repo,
		pull_number: Number(prNumber),
	});

	if (!pullRequest?.title?.includes('Deploy to production')) return '';
	return pullRequest.body;
}

const computeReleaseBody = async (params) => {
	let { message } = params;

	if (/^Merge pull request/.test(message)) {
		message = await getCommitPullRequestBody(params);
	}

	message = message.replace(/^(.|\n|\r)+(## Release Summary)/, '$2');
	return message;
}

const slackIDs = {
	'dmkorb': 'U0256NC37GT',
	'rogerpadilla': 'U02FR157SG1',
	'grimmer0125': 'U03BZH4CYBD',
	'Riddhish97': 'U04H6BQ6V0T',
	'MrMuhammadAbdullah1704': 'U01G1J5HYG5',
	'FatimahAbdullah': 'U0277DZ97JL',
	'hoangvvo': 'U03B3E4UPV3',
	'azka-01': 'U0258AV7R3M',
	'samuelayo': 'UFHCU47B6',
	'greguintow': 'U02DDCN2UDC',
	'ugokoli': 'U01378G4H28',
	'sumitkolhe': 'U04PZD94TAR',
	'rgautam98': 'U03AAU48XL3',
	'ProKashif': 'U01GUG3L4D6',
	'sudotong': 'U04KDQACM',
	'Lutif': 'U01N11L5BD0',
	'Nilomiranda': 'U02GNJGBPJ7',
	'thadeuk': 'U02G82H7QR2',
	'carloscdante': 'D04HD1C8PMW',
	'wilforlan': 'UC0UWLSQ2',
	'jhho89': 'U01HB1J09PF',
	'longyarnz': 'UH8DQ3PRA',
	'xage93': 'U043X1K6810',
	'kashyap-sojitra': 'U05RBAXUJUX',
	'htkimura': 'U061P10ADNV',
	'ghimire007': 'U065MEQ96AU',
	'fisfat': 'UKLEEP4F6',
	'gabrielcsf': 'U06180NQGPQ',
	'Serdar-FF': 'U067AUL8HG8',
	'atomicman57': 'U8EGXN80Z',
	'cchitsiang': 'U0544MQ3ZNK',
	'cokpakpo': 'U016WC4SFK6',
	'darangi': 'U03D9GMQM7T',
	'deepak29ff': 'U05R3RBKQ0G',
	'haziqAhmed92': 'U02HAU99A1G',
	'jonathantissot': 'U04UV9H5J23',
	'karchig': 'U01JKURD05U',
	'willpoint': 'UJ7P83H7T',
	'zekeri-riya': 'U01374NRKGU',
	'zypher606': 'U021VD0J2UE',
	'sleemkeen': 'U01QSFC4QUE',
	'shivamluthra': 'U043X0VCASE',
	'samuelfruhauf': 'U02M3F53PU7',
	'rafakato': 'U02PMSZDNE6',
	'sahilchauhan36': 'U068VP8DLEL',
	'mHamza301': 'U022K5F8ZB3',
	'm3rryqold': 'U0560E5H41F',
	'mustay': 'U05M9EJMY72',
	'MBilal07': 'U022EQJQBMF',
	'marinamsm': 'U02GY8JRYLA',
	'alirazachishti': 'U01FPUCJDP1',
	'ndeitch': 'U024CECHHBP',
	'robert-sarosi': 'U06MR0J3MC0',
	'codinger41': 'U06S3KV9G5P',
	'FoysalOsmany': 'U01UDGB0RR8',
	'anveshr1': 'U01PC2FDE65',
	'noghartt': 'U074XBKUX1R',
	'luckpng': 'U0785C4MZ1A',
	'Nickrosendo': 'U076TTEDQJX',
	'asozcan': 'U07FEPGH677'
}

module.exports = {
	createRelease: async ({ github, context }) => {
		const { data: latest } = await github.rest.repos.getLatestRelease({
			...context.repo,
		}).then((data) => {
			return data;
		}).catch((err) => {
			if (err.status === 404) {
				return {
					data: {
						tag_name: 'v0.0.0'
					}
				}
			}

			throw err;
		});

		const sha = context.sha;
		const { data: commit } = await github.rest.git.getCommit({
			...context.repo,
			commit_sha: sha
		})

		const { message } = commit;
		const body = await computeReleaseBody({ github, context, message })
		const tagName = computeReleaseName({
			name: latest.tag_name,
			isFeature: /- New Feature/gm.test(message),
			isBreaking: /- Breaking Change/gm.test(message)
		});

		console.log(message);
		console.log(tagName);
		console.log(body);

		const { data: release } = await github.rest.repos.createRelease({
			...context.repo,
			tag_name: tagName,
			body,
			target_commitish: sha,
			generate_release_notes: true
		});

		return release;
	},
	notifySlack: async ({ WebClient, release, format, context }) => {
		let body = release.body.replace(/\* Deploy to production (.|\n|\r)*$/, '').trim(); // Remove redundant text from release body
		for (const user in slackIDs) {
			const pattern = new RegExp(`@${user}`, 'ig');
			body = body.replaceAll(pattern, `<@${slackIDs[user]}>`); // Convert github usernames to slack usernames
		}

		console.info('Before Formatting: ', body);
		body = body.replaceAll(/<![^<>]+>/g, ''); // Remove <!-- ... --> strings
		body = body.replaceAll(/(\w|`)(\n|\r)+(\w|`)/g, '$1 $3'); // Remove unintentional line breaks between words and tilde
		body = body.replaceAll(/\n\s+-/g, '\n-'); // Remove white space between line break and bullet
		body = body.replaceAll(/\* (.+) (by .+) in (https:\/\/.+)(\n)*/g, '* [$1]($3) $2$4'); // Convert PR title to hyperlink
		const [summary, changes] = body.split(`## What's Changed`); // Split summaries from changes

		const { owner, repo } = context.repo;
		body = `
[Deploying ${release.name}](${release.html_url}) to \`${owner}/${repo}\`
## What's Changed
${changes.trim()}

${summary.trim()}
`;

		body = format(body);
		body = body.replaceAll(/\n+(?!(•|\*))/g, ' ').replaceAll(/\n(\*)/g, '\n\n$1'); // Remove all internal line breaks that are not succeeded by bullet points or headers
		console.info('After Formatting: ', body);

		const featureRolloutChannel = 'C0162DEUX08';
		const slack = new WebClient(process.env.SLACK_TOKEN);
		slack.chat.postMessage({
			channel: featureRolloutChannel,
			text: body
		})
	}
}