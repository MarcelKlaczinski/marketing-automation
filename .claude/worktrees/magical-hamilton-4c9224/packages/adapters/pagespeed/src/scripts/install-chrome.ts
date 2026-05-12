#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { Browser, computeExecutablePath, install } from "@puppeteer/browsers";

const CHROME_BUILD_ID = "stable";
const CACHE_DIR = join(homedir(), ".cache", "puppeteer");

console.log(`Installing Chrome (${CHROME_BUILD_ID}) to ${CACHE_DIR}...`);

const installed = await install({
  cacheDir: CACHE_DIR,
  browser: Browser.CHROME,
  buildId: CHROME_BUILD_ID,
});

console.log(`Chrome installed at: ${installed.executablePath}`);

const verified = computeExecutablePath({
  cacheDir: CACHE_DIR,
  browser: Browser.CHROME,
  buildId: CHROME_BUILD_ID,
});
console.log(`Verified path: ${verified}`);
process.exit(0);
