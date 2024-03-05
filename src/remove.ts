import { getAccessToken } from "./shared/auth";
import {
  convertToSiteUrl,
  getPublishMetadata,
  getEmojiForStatus,
  getPageIndexingStatus,
  requestDeleting,
} from "./shared/gsc";
import { Status } from "./shared/types";
import { batch } from "./shared/utils";
import { mkdirSync, writeFileSync } from "fs";
import { readCSVFile } from "./shared/csv";

const CACHE_TIMEOUT = 1000 * 60 * 60 * 24 * 14; // 14 days

type CSVRow = {
  url: string;
};

const main = async () => {
  const input = process.argv[2];
  const csvFile = process.argv[3];

  if (!input) {
    console.error("❌ Please provide a domain or site URL as the first argument.");
    console.error("");
    process.exit(1);
  }

  if (!csvFile) {
    console.error("❌ Please provide a csv file as the second argument.");
    console.error("");
    process.exit(1);
  }

  const urls = await readCSVFile<CSVRow>(csvFile);

  const accessToken = await getAccessToken();
  const siteUrl = convertToSiteUrl(input);
  console.log(`🔎 Processing site: ${siteUrl}`);
  const cachePath = `.cache/${siteUrl
    .replace("http://", "http_")
    .replace("https://", "https_")
    .replace("/", "_")}.json`;

  if (!accessToken) {
    console.error("❌ Failed to get access token, check your service account credentials.");
    console.error("");
    process.exit(1);
  }

  const pages = urls.map((row) => row.url);

  if (pages.length === 0) {
    console.error("❌ No pages found, add them to the csv.");
    console.error("");
    process.exit(1);
  }

  console.log(`👉 Found ${pages.length} URLs in ${csvFile} file`);

  const statusPerUrl: Record<string, { status: Status; lastCheckedAt: string }> = {};
  const pagesPerStatus: Record<Status, string[]> = {
    [Status.SubmittedAndIndexed]: [],
    [Status.DuplicateWithoutUserSelectedCanonical]: [],
    [Status.CrawledCurrentlyNotIndexed]: [],
    [Status.DiscoveredCurrentlyNotIndexed]: [],
    [Status.PageWithRedirect]: [],
    [Status.URLIsUnknownToGoogle]: [],
    [Status.RateLimited]: [],
    [Status.Forbidden]: [],
    [Status.Error]: [],
  };

  const deletableStatuses = [Status.SubmittedAndIndexed];

  const shouldRecheck = (status: Status, lastCheckedAt: string) => {
    const shouldDeleteIt = deletableStatuses.includes(status);
    const isOld = new Date(lastCheckedAt) < new Date(Date.now() - CACHE_TIMEOUT);
    return shouldDeleteIt || isOld;
  };

  await batch(
    async (url) => {
      let result = statusPerUrl[url];
      if (!result || shouldRecheck(result.status, result.lastCheckedAt)) {
        const status = await getPageIndexingStatus(accessToken, siteUrl, url);
        result = { status, lastCheckedAt: new Date().toISOString() };
        statusPerUrl[url] = result;
      }

      pagesPerStatus[result.status] = pagesPerStatus[result.status] ? [...pagesPerStatus[result.status], url] : [url];
    },
    pages,
    50,
    (batchIndex, batchCount) => {
      console.log(`📦 Batch ${batchIndex + 1} of ${batchCount} complete`);
    },
  );

  console.log(``);
  console.log(`👍 Done, here's the status of all ${pages.length} pages:`);
  mkdirSync(".cache", { recursive: true });
  writeFileSync(cachePath, JSON.stringify(statusPerUrl, null, 2));

  for (const status of Object.keys(pagesPerStatus)) {
    const pages = pagesPerStatus[status as Status];
    if (pages.length === 0) continue;
    console.log(`• ${getEmojiForStatus(status as Status)} ${status}: ${pages.length} pages`);
  }
  console.log("");

  const deletablePages = Object.entries(pagesPerStatus).flatMap(([status, pages]) =>
    deletableStatuses.includes(status as Status) ? pages : [],
  );

  if (deletablePages.length === 0) {
    console.log(`✨ There are no pages that can be deleted. Everything is already deleted!`);
  } else {
    console.log(`✨ Found ${deletablePages.length} pages that can be removed.`);
    deletablePages.forEach((url) => console.log(`• ${url}`));
  }
  console.log(``);

  for (const url of deletablePages) {
    console.log(`📄 Processing url: ${url}`);
    const status = await getPublishMetadata(accessToken, url);
    if (status === 404) {
      await requestDeleting(accessToken, url);
      console.log("🚀 Deleting requested successfully. It may take a few days for Google to process it.");
    } else if (status < 400) {
      console.log(`🕛 Deleted already requested previously. It may take a few days for Google to process it.`);
    }
    console.log(``);
  }

  console.log(`👍 All done!`);
  console.log(`💖 Brought to you by https://seogets.com - SEO Analytics.`);
  console.log(``);
};

main();
