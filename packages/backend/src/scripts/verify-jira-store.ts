import { arg, load, passwordSource, safeSummary } from './jira-store-common.js';
const store = await load(arg('--store')!, passwordSource()); console.log(JSON.stringify({ result: 'PASS', ...safeSummary(store) }, null, 2));
