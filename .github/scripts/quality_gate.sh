#!/bin/bash

authToken=$GITHUB_TOKEN
repo=$REPO
urlGitHubApi="https://api.github.com/repos/firefliesai/$repo"
getFile="resultGET_$repo.json"

echo "GET $urlGitHubApi/code-scanning/alerts"


curl -H "Authorization: token $authToken" -X GET "$urlGitHubApi/code-scanning/alerts" | jq "." > $getFile

echo "Reading data and storing in variables..."


alertCount=$(jq '. | length' $getFile)

echo "Number of alerts found: $alertCount"

if [ $alertCount -gt 0 ]; then

    non_fixed_count=$(jq '[.[] | select(.fixed_at == null)] | length' "$getFile")
    echo "Number of non-fixed alerts: $non_fixed_count"


    if [ "$non_fixed_count" -gt 10 ]; then
        echo "\033[31mERROR: There are more than 10 non-fixed alerts in the repository. Please verify the alerts on the below links. Exiting...\033[0m"
        echo "Links to all alerts:"
        jq -r '.[] | .html_url' "$getFile"
        echo "ERROR: There are more than 10 non-fixed alerts in the repository. Please verify the alerts on the below links." >> $GITHUB_STEP_SUMMARY
        jq -r '.[] | .html_url' "$getFile" >> $GITHUB_STEP_SUMMARY
        exit 1
    fi


    if [ "$non_fixed_count" -gt 5 ]; then
        echo "\033[33mWARNING: There are more than 5 non-fixed alerts in the repository. Please verify the alerts on the below links.\033[0m"
        echo "Links to all alerts:"
        jq -r '.[] | .html_url' "$getFile"
        echo "WARNING: There are more than 5 non-fixed alerts in the repository. Please verify the alerts on the below links." >> $GITHUB_STEP_SUMMARY
        jq -r '.[] | .html_url' "$getFile" >> $GITHUB_STEP_SUMMARY
    fi

else
    echo "No security alerts have been found in this repo, well done!"
fi

echo "Finished"
