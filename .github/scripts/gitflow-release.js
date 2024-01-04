// @ts-check
/** @param {import('github-script').AsyncFunctionArguments & { pull_number: number, pull_numbers_in_release: string }} AsyncFunctionArguments */
export default async ({ core, context, github, pull_number, pull_numbers_in_release }) => {
  const mergedPrNumbers = Array.from(new Set(pull_numbers_in_release.split(',').map(Number)));
  
  const pr = await github.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number,
  });
 
  const body = pr.data.body;
  if (!body) {
    core.setFailed("No PR body");
    return;
  }

  // Get the PRs and parse the release summary
  const mergedPrs = await Promise.all(mergedPrNumbers.map(async (prNumber) => {
    const pr = await github.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber
    });
    if (!pr.data.body) {
      return;
    }
    const regex = /\#\# What does this PR do\?([\s\S]*?)\n\#\#/gm;
    const match = regex.exec(pr.data.body)
    return match?.[1]?.trim();
  })).then((prs) => prs.filter(Boolean));
  const releaseSummary = mergedPrs.map(pr => pr?.includes("\n") ? pr : `* ${pr}`).join('\n');

  // Update the PR body
  await github.rest.pulls.update({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number,
    body: body.replace("## Release summary", `## Release summary\n\n${releaseSummary}`)
  });

};