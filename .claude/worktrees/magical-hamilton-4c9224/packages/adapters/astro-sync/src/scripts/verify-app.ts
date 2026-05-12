#!/usr/bin/env bun
import { getGitHubApp } from "../github-auth.ts";

try {
  const app = await getGitHubApp();
  const { data } = await app.octokit.request("GET /app");
  const slug = data?.slug ?? "(unknown)";
  const id = data?.id ?? "?";
  const ownerLogin =
    data?.owner && "login" in data.owner ? (data.owner as { login: string }).login : "?";
  const perms = data?.permissions ? JSON.stringify(data.permissions) : "{}";
  console.log(`✅ GitHub App authenticated: ${slug} (id: ${id})`);
  console.log(`   Owner: ${ownerLogin}`);
  console.log(`   Permissions: ${perms}`);
  process.exit(0);
} catch (e) {
  console.error(`❌ GitHub App auth failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
