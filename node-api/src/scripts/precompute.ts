// Fills listing_cache (zones + commute + block) for every listing so the demo depends only on the LLM.
// TODO(Prasham): write results into Supabase listing_cache via db().
import { buildings, getListings } from '../data.js'
import { zoneCheck } from '../services/zones.js'
import { commute } from '../services/commute.js'

for (const l of getListings()) {
  const zones = zoneCheck(l.lat, l.lng)
  const c = await commute(l, buildings)
  console.log(l.id, JSON.stringify(zones), `${c.length} commutes`)
}
