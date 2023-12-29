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

const slackIDs = {
	'anooppoommen': 'U038VBD2XCP',
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
	'debloper': 'USG05RE76',
	'rgautam98': 'U03AAU48XL3',
	'ProKashif': 'U01GUG3L4D6',
	'sudotong': 'U04KDQACM',
	'Lutif': 'U01N11L5BD0',
	'Nilomiranda': 'U02GNJGBPJ7',
	'thadeuk': 'U02G82H7QR2',
	'carloscdante': 'D04HD1C8PMW',
	'wilforlan': 'UC0UWLSQ2',
	'hamidladan': 'U043NHY5HNF',
	'jhho89': 'U01HB1J09PF',
	'longyarnz': 'UH8DQ3PRA',
	'xage93': 'U043X1K6810',
	'kashyap-sojitra': 'U05RBAXUJUX',
	'htkimura': 'U061P10ADNV',
	'ghimire007': 'U065MEQ96AU'
}

module.exports = {
	createRelease: async ({ github, context }) => {
		const { data: latest } = await github.rest.repos.getLatestRelease({
			...context.repo,
		});

		const sha = context.sha;
		const { data: commit } = await github.rest.git.getCommit({
			...context.repo,
			commit_sha: sha
		})

		const body = commit.message.replace(/^(.|\n|\r)+(## Release Summary)/, '$2'); // Remove pr title from body
		const tagName = computeReleaseName({
			name: latest.tag_name,
			isFeature: /- New Feature/gm.test(commit.message),
			isBreaking: /- Breaking Change/gm.test(commit.message)
		});

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

		console.info(JSON.stringify(body));
		body = body.replaceAll(/<![^<]+>/g, ''); // Remove <!-- ... --> strings
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
		console.info(JSON.stringify(body));
		body = body.replaceAll(/\n+(?!(•|\*))/g, ' ').replaceAll(/\n(\*)/g, '\n\n$1'); // Remove all internal line breaks that are not succeeded by bullet points or headers
		console.info(body);

		const featureRolloutChannel = 'C0162DEUX08';
		const slack = new WebClient(process.env.SLACK_TOKEN);
		slack.chat.postMessage({
			channel: featureRolloutChannel,
			text: body
		})
	}
}