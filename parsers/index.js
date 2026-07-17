// Registry of hardcoded supported sources/parsers.
// User-facing saved searches live in parsers/searches.js and are mapped to
// these supported sources at scan time.

import * as exampleSinglePhase from './example-single-phase.js';
import * as exampleTwoPhase from './example-two-phase.js';
import * as weworkremotely from './weworkremotely.js';
import * as euremotejobs from './euremotejobs.js';

export const SOURCES = {
  'example-single-phase': {
    originPattern: exampleSinglePhase.originPattern,
    listUrls: exampleSinglePhase.listUrls,
    extractLinks: exampleSinglePhase.extractLinks,
    extractDetail: exampleSinglePhase.extractDetail,
  },
  'example-two-phase': {
    originPattern: exampleTwoPhase.originPattern,
    listUrls: exampleTwoPhase.listUrls,
    extractLinks: exampleTwoPhase.extractLinks,
    extractDetail: exampleTwoPhase.extractDetail,
  },
  weworkremotely: {
    originPattern: weworkremotely.originPattern,
    listUrls: weworkremotely.listUrls,
    extractLinks: weworkremotely.extractLinks,
    extractDetail: weworkremotely.extractDetail,
  },
  euremotejobs: {
    originPattern: euremotejobs.originPattern,
    listUrls: euremotejobs.listUrls,
    extractLinks: euremotejobs.extractLinks,
    extractDetail: euremotejobs.extractDetail,
  },
};

/** @returns {Promise<Record<string, object>>} */
export async function getAllSources() {
  return { ...SOURCES };
}

/** @param {string} name @returns {boolean} */
export function isSupportedSource(name) {
  return name in SOURCES;
}
