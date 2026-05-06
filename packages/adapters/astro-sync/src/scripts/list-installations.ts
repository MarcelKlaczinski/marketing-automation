#!/usr/bin/env bun
import { getGitHubApp } from "../github-auth.ts";

const app = await getGitHubApp();

console.log("Listing all installations of this GitHub App:\n");

for await (const { installation } of app.eachInstallation.iterator()) {
  const octokit = await app.getInstallationOctokit(installation.id);
  const { data } = await octokit.request("GET /installation/repositories", { per_page: 100 });

  const repoNames = data.repositories.map((r: { full_name: string }) => r.full_name).join(", ");
  const accountLogin =
    installation.account && "login" in installation.account
      ? (installation.account as { login: string }).login
      : "?";

  console.log(`Installation ${installation.id}\n  Account: ${accountLogin}\n  Repos: ${repoNames}\n`);
}

process.exit(0);
