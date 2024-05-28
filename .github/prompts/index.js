const getPromptPRDescription = (description) =>
	'Please review the following pull request description for security vulnerabilities, especially about authentication and authorization.' +
	'Check if the description mentions an authentication or authorization change that might affects a critical endpoint.' +
	'Additionally, provide suggestions for how to address the identified vulnerabilities, with a focus on security. ' +
	'Do not write the code or guidelines in the review. Only write the review itself.\n\n' +
	'Use markdown formatting for your response, write in english and with concise, clear sentences:\n\n' +
	`### Pull Request Description\n${description}\n\n` +
	'### Review Guidelines\n' +
	'1. **Critical Endpoint Authentication**: Has the pull request made any changes related to authentication or authorization that could affect critical endpoints or affect users permissions? If no changes like that exist in the description, just respond "The description does not mention any changes related to authentication or authorization"\n' +
	'2. **Impact Analysis**: Assess the potential impact of these changes on system security and functionality, unless there are no changes related to authentication or authorization, then just respond "The description does not mention any changes related to authentication or authorization".\n' +
	'3. **Recommendation**: If authentication or authorization changes are present, then recommend a few actions to minimize the risk of those changes, otherwise just respond "No recommendations".\n';

module.exports = {
	getPromptPRDescription,
};