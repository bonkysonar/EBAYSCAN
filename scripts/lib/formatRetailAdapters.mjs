import { parseMagentoGroupedVinyl } from './magentoGroupedCatalog.mjs';
import { parseThrillJockeyVinyl } from './thrillJockeyCatalog.mjs';
import { parseTopshelfVinyl } from './topshelfCatalog.mjs';
import { parseDominoVinyl } from './dominoCatalog.mjs';

const adapters = {
  'yep-roc': {host:'yeproc.11spot.com',parse:(html,url)=>parseMagentoGroupedVinyl(html,url,'USD').items},
  'thrill-jockey': {host:'www.thrilljockey.com',parse:parseThrillJockeyVinyl},
  'topshelf-records': {host:'www.topshelfrecords.com',parse:parseTopshelfVinyl},
  'domino-us': {host:'m.dominomusic.com',parse:parseDominoVinyl},
  'domino-mart': {host:'m.dominomusic.com',parse:parseDominoVinyl},
};

export function formatRetailAdapter(sourceId) { return adapters[sourceId] ?? null; }
