// @ts-check
/** @param {import('github-script').AsyncFunctionArguments & { pull_number: number, pull_numbers_in_release: string, latest_release_tag_name?: string }} AsyncFunctionArguments */
export default async ({ core, context, github, pull_numbers_in_release }) => {
  try {
    const mergedPrNumbers = Array.from(new Set(pull_numbers_in_release.split(',').map(Number)));
    
    // Get the PRs and parse the release summary
    const mergedPrs = await Promise.all(mergedPrNumbers.map(async (prNumber) => {
      const pr = await github.rest.pulls.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: prNumber
      });
      const body = pr.data.body || "";
      const regex = /\#\# What does this PR do\?([\s\S]*?)\n\#\#/gm;
      let match = regex.exec(body)?.[1]?.trim();
      
      // try to remove empty lines and format bullets
      match = match?.split('\n').map(s => s.trim()).filter(Boolean).map(
        s => s.startsWith('-') || s.startsWith('*') ? s : `* ${s}`
      ).join('\n');

      let type = 0 // patch
      if (body.includes("[x] Feature")) {
        type = 1 // minor
      }

      return {
        title: pr.data.title,
        summary: match,
        type,
      }
    })).then((prs) => prs.filter(pr => !!pr));
    
    const releaseSummary = mergedPrs.map((pr) => {
      return `${pr.title}\n${pr.summary}`;
    }).join('\n\n');

    const versionIncrementType = Math.max(...mergedPrs.map((pr) => pr.type));
    const versionIncrement = ['patch', 'minor', 'major'][versionIncrementType] || 'patch';;

    console.log(`Determined suggested version increment (${versionIncrement})`)
    console.log(`Release summary:\n${releaseSummary}`);

    core.setOutput('release_summary', releaseSummary);
    core.setOutput('version_increment', versionIncrement);
  } catch (error) {
    console.log(`Could not determine release summary and version_increment`)
    console.log(error)
  }
};