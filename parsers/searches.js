import * as exampleSinglePhase from './example-single-phase.js';
import * as exampleTwoPhase from './example-two-phase.js';
import * as weworkremotely from './weworkremotely.js';
import * as euremotejobs from './euremotejobs.js';

const SEARCHES_KEY = 'searches.saved';
const DISABLED_SEARCHES_KEY = 'searches.disabled';

const LEGACY_SEARCHES_KEY = 'sources.custom';
const LEGACY_DISABLED_KEY = 'sources.disabled';
const REMOVED_DEMO_SEARCH_NAMES = new Set(['hacker-news-jobs', 'remoteok-jobs', 'weworkremotely-jobs']);

export const SUPPORTED_SOURCES = {
  'hacker-news': {
    label: 'Hacker News',
    origin: 'https://news.ycombinator.com',
    originPattern: exampleSinglePhase.originPattern,
    extractLinks: exampleSinglePhase.extractLinks,
    extractDetail: exampleSinglePhase.extractDetail,
  },
  remoteok: {
    label: 'Remote OK',
    origin: 'https://remoteok.com',
    originPattern: exampleTwoPhase.originPattern,
    extractLinks: exampleTwoPhase.extractLinks,
    extractDetail: exampleTwoPhase.extractDetail,
  },
  weworkremotely: {
    label: 'We Work Remotely',
    origin: 'https://weworkremotely.com',
    originPattern: weworkremotely.originPattern,
    extractLinks: weworkremotely.extractLinks,
    extractDetail: weworkremotely.extractDetail,
  },
  euremotejobs: {
    label: 'EU Remote Jobs',
    origin: 'https://euremotejobs.com',
    originPattern: euremotejobs.originPattern,
    extractLinks: euremotejobs.extractLinks,
    extractDetail: euremotejobs.extractDetail,
  },
};

/** @returns {Promise<Array<object>>} */
export async function getSearches() {
  const stored = await chrome.storage.local.get([SEARCHES_KEY, LEGACY_SEARCHES_KEY]);
  if (SEARCHES_KEY in stored) {
    const storedSearches = normalizeSearches(stored[SEARCHES_KEY]);
    const searches = removeRemovedDemoSearches(storedSearches);
    if (searches.length !== storedSearches.length) {
      await chrome.storage.local.set({ [SEARCHES_KEY]: searches });
    }
    return searches;
  }

  const legacySearches = removeRemovedDemoSearches(normalizeSearches(stored[LEGACY_SEARCHES_KEY]));
  if (legacySearches.length > 0) {
    await chrome.storage.local.set({ [SEARCHES_KEY]: legacySearches });
  }
  return legacySearches;
}

/** @param {string} text @returns {string[]} */
export function parseListUrls(text) {
  return (text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {{ name: string, listUrls: string[] }} input
 * @returns {Promise<object>}
 */
export async function addSearch({ name, listUrls }) {
  const slug = slugify(name);
  if (!slug) throw new Error('Name is required');

  if (!listUrls || listUrls.length === 0) {
    throw new Error('At least one List URL is required');
  }

  const supportedUrls = parseSupportedUrls(listUrls);
  const originPatterns = getSearchOriginPatterns({ listUrls });
  const entry = {
    name: slug,
    listUrls: supportedUrls.map(({ url }) => url.href),
    originPatterns,
    createdAt: Date.now(),
  };

  const searches = await getSearches();
  if (searches.some((search) => search.name === slug)) {
    throw new Error(`A search named "${slug}" already exists`);
  }

  await chrome.storage.local.set({ [SEARCHES_KEY]: [...searches, entry] });
  return entry;
}

/**
 * @param {string} originalName
 * @param {{ name: string, listUrls: string[] }} input
 * @returns {Promise<object>}
 */
export async function updateSearch(originalName, { name, listUrls }) {
  const slug = slugify(name);
  if (!slug) throw new Error('Name is required');

  if (!listUrls || listUrls.length === 0) {
    throw new Error('At least one List URL is required');
  }

  const supportedUrls = parseSupportedUrls(listUrls);
  const originPatterns = getSearchOriginPatterns({ listUrls });
  const searches = await getSearches();
  const index = searches.findIndex((search) => search.name === originalName);
  if (index === -1) {
    throw new Error(`Search "${originalName}" was not found`);
  }
  if (searches.some((search) => search.name === slug && search.name !== originalName)) {
    throw new Error(`A search named "${slug}" already exists`);
  }

  const previous = searches[index];
  const entry = {
    ...previous,
    name: slug,
    listUrls: supportedUrls.map(({ url }) => url.href),
    originPatterns,
    updatedAt: Date.now(),
  };
  const next = [...searches];
  next[index] = entry;
  await chrome.storage.local.set({ [SEARCHES_KEY]: next });

  if (slug !== originalName) {
    const disabled = new Set(await getDisabledSearches());
    if (disabled.delete(originalName)) {
      disabled.add(slug);
      await chrome.storage.local.set({ [DISABLED_SEARCHES_KEY]: [...disabled] });
    }
  }

  return entry;
}

/** @param {string} name @returns {Promise<void>} */
export async function removeSearch(name) {
  const searches = await getSearches();
  await chrome.storage.local.set({ [SEARCHES_KEY]: searches.filter((search) => search.name !== name) });
  await setSearchEnabled(name, true);
}

/** @returns {Promise<string[]>} */
export async function getDisabledSearches() {
  const stored = await chrome.storage.local.get([DISABLED_SEARCHES_KEY, LEGACY_DISABLED_KEY]);
  const storedDisabled = normalizeNameList(stored[DISABLED_SEARCHES_KEY]);
  const disabled = removeRemovedDemoNames(storedDisabled);
  if (DISABLED_SEARCHES_KEY in stored) {
    if (disabled.length !== storedDisabled.length) {
      await chrome.storage.local.set({ [DISABLED_SEARCHES_KEY]: disabled });
    }
    return disabled;
  }

  const legacyDisabled = removeRemovedDemoNames(normalizeNameList(stored[LEGACY_DISABLED_KEY]));
  if (legacyDisabled.length > 0) {
    await chrome.storage.local.set({ [DISABLED_SEARCHES_KEY]: legacyDisabled });
  }
  return legacyDisabled;
}

/** @param {string} name @param {boolean} enabled @returns {Promise<void>} */
export async function setSearchEnabled(name, enabled) {
  const disabled = new Set(await getDisabledSearches());
  if (enabled) {
    disabled.delete(name);
  } else {
    disabled.add(name);
  }
  await chrome.storage.local.set({ [DISABLED_SEARCHES_KEY]: [...disabled] });
}

/** @param {object} search @returns {string[]} */
export function getSearchOriginPatterns(search) {
  const patterns = search.originPatterns || parseSupportedUrls(search.listUrls || []).map(({ source }) => source.originPattern);
  return [...new Set(patterns)].filter(Boolean);
}

/**
 * Turns user-facing saved searches into crawler jobs backed by supported sources.
 * A single saved search may produce several crawler jobs when its URLs belong
 * to different supported sites.
 * @returns {Promise<{runnableEntries: Array<[string, object]>, disabledSearches: string[], invalidSearches: Array<{name: string, message: string}>}>}
 */
export async function getSearchRunPlan() {
  const searches = await getSearches();
  const disabled = new Set(await getDisabledSearches());
  const runnableEntries = [];
  const disabledSearches = [];
  const invalidSearches = [];

  for (const search of searches) {
    if (disabled.has(search.name)) {
      disabledSearches.push(search.name);
      continue;
    }

    let runs;
    try {
      runs = toCrawlerRuns(search);
    } catch (err) {
      invalidSearches.push({
        name: search.name || 'unnamed search',
        message: err?.message || String(err),
      });
      continue;
    }

    for (const run of runs) {
      runnableEntries.push([run.runName, run.parser]);
    }
  }

  return { runnableEntries, disabledSearches, invalidSearches };
}

/** @param {object} search @returns {Array<{runName: string, parser: object}>} */
export function toCrawlerRuns(search) {
  const grouped = new Map();

  for (const { url, sourceName, source } of parseSupportedUrls(search.listUrls || [])) {
    if (!grouped.has(sourceName)) {
      grouped.set(sourceName, { source, listUrls: [] });
    }
    grouped.get(sourceName).listUrls.push(url.href);
  }

  const hasSeveralSources = grouped.size > 1;
  return [...grouped.entries()].map(([sourceName, group]) => ({
    runName: hasSeveralSources ? `${search.name} / ${group.source.label}` : search.name,
    parser: {
      searchName: search.name,
      supportedSourceName: sourceName,
      originPattern: group.source.originPattern,
      originPatterns: [group.source.originPattern],
      listUrls: group.listUrls,
      extractLinks: group.source.extractLinks,
      extractDetail: group.source.extractDetail,
    },
  }));
}

function parseSupportedUrls(listUrls) {
  const parsed = [];
  const unsupportedOrigins = new Set();

  for (const rawUrl of listUrls) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('One of the List URLs is not a valid URL');
    }

    const match = getSupportedSourceForUrl(url);
    if (!match) {
      unsupportedOrigins.add(url.origin);
      continue;
    }
    parsed.push({ url, ...match });
  }

  if (unsupportedOrigins.size > 0) {
    throw new Error(
      `Unsupported site: ${[...unsupportedOrigins].join(', ')}. Supported sites: ${getSupportedOriginList().join(', ')}`
    );
  }

  return parsed;
}

function getSupportedSourceForUrl(url) {
  for (const [sourceName, source] of Object.entries(SUPPORTED_SOURCES)) {
    if (url.origin === source.origin) return { sourceName, source };
  }
  return null;
}

function getSupportedOriginList() {
  return Object.values(SUPPORTED_SOURCES).map((source) => source.origin);
}

function normalizeSearches(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry.name === 'string' && Array.isArray(entry.listUrls))
    .map((entry) => ({
      name: entry.name,
      listUrls: entry.listUrls,
      originPatterns: entry.originPatterns || (entry.originPattern ? [entry.originPattern] : getSearchOriginPatterns(entry)),
      createdAt: entry.createdAt || Date.now(),
    }));
}

function normalizeNameList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function removeRemovedDemoSearches(searches) {
  return searches.filter((search) => !REMOVED_DEMO_SEARCH_NAMES.has(search.name));
}

function removeRemovedDemoNames(names) {
  return names.filter((name) => !REMOVED_DEMO_SEARCH_NAMES.has(name));
}

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
