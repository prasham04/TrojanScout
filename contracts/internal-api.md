# Node `/internal/*` (agent tools) — header `X-Internal-Key: $INTERNAL_KEY` required

| Route                     | Input                               | Output |
|---------------------------|-------------------------------------|--------|
| POST /internal/search     | `{maxRent, beds, inFryft, inDps}`   | candidate listings (≤20) |
| POST /internal/zone-check | `{lat, lng}`                        | `{inDps, inFryft, metersToFryftEdge}` |
| POST /internal/commute    | `{listingId, buildingIds}`          | `[{building, walk, bike, tram}]` |
| POST /internal/true-cost  | `{listingId, profile}`              | `{rent, utilities, transit, rideshare, total, assumptions[]}` |
| POST /internal/score      | `{listingIds, profile}`             | `[{listingId, fitScore}]` |

Profile: `{ budget, buildingIds: number[], lateNights, priorities: {cost, commute, zone, incidents} }`
