// Keep in sync with /contracts, node-api and ai-service (app/listings/models.py).
export interface Listing {
  id: string; source: string; url: string; name: string; address: string; lat: number; lng: number
  rent: number | null; rentMax?: number | null; priceUnit: string; callForPricing?: boolean
  beds: number | null; bedsMax?: number | null; baths?: number | null; availability?: string | null
  propertyTypes?: string[]; amenities?: string[]; photos?: string[]; description?: string
  utilitiesEst: number; distanceToCampusMi?: number | null; scrapedAt?: string
  inDps?: boolean; inFryft?: boolean; metersToFryftEdge?: number
}
export interface SearchHit extends Listing { score: number | null; denseRank: number | null; bm25Rank: number | null }
export interface SearchResponse { query: string; filters: Record<string, unknown>; count: number; tookMs: number; results: SearchHit[] }
export interface Meta { count: number; scrapedAt: string | null; sources: Record<string, unknown>; inDps: number; inFryft: number; medianRent: number | null }

export interface Building { id: number; name: string; code: string; lat: number; lng: number; campus?: 'UPC' | 'HSC' }
export interface Zones { inDps: boolean; inFryft: boolean; metersToFryftEdge: number }
export interface Commute { building: string; walk: number; bike: number; tram: number | null }
export interface Citation { n: number; source: string; date: string; url: string }
export interface Block { summary: string; incidents6mo: Record<string, number>; citations: Citation[] }
// rent/total are null when the listing doesn't publish a price ("call for pricing")
export interface Cost { rent: number | null; utilities: number; transit: number; rideshare: number; total: number | null; assumptions: string[] }
export interface Report { listing: Listing; zones: Zones; commute: Commute[]; block: Block; cost: Cost; fitScore: number }

export interface Priorities { cost: number; commute: number; zone: number; incidents: number }
/** How a whole apartment's rent is split: one person per bedroom ('private') or two ('shared'). */
export type Sharing = 'private' | 'shared'
export interface Profile { budget: number; buildingIds: number[]; lateNights: number; priorities: Priorities; sharing?: Sharing }

export type ChatEvent =
  | { event: 'step'; data: { label: string; status: 'running' | 'done' } }
  | { event: 'listings'; data: { ids: string[]; reasons?: Record<string, string[]>; fit?: Record<string, number | null> } }
  | { event: 'understood'; data: { chips: string[]; relaxed: string[]; rankedBy: string | null; parser: string | null; anchor: string | null } }
  | { event: 'token'; data: { text: string } }
  | { event: 'error'; data: { message: string } }
  | { event: 'done'; data: Record<string, never> }

// ---- v2: floorplans, smart search, safety ----
export interface Unit { label: string; roomType: 'entire' | 'private_room' | 'shared_room'; beds: number | null; baths: number | null; privateBath: boolean | null; rent: number | null; count: number }
export interface ListingV2 extends Listing { units?: Unit[]; roomTypes?: string[]; sampleData?: boolean; photoCredit?: string }
export interface Chip { key: string; label: string }
export interface SmartHit extends ListingV2 { matchedUnits: Unit[]; walkMin: number | null; score: number | null; cosine?: number | null; denseRank: number | null; bm25Rank: number | null }
export interface SmartSearchResponse {
  query: string; parser: 'rules' | 'rules+llm'; understood: Chip[]; semanticText: string; filters: Record<string, unknown>
  count: number; tookMs: number; results: SmartHit[]
}
export interface FitPart { value: number; weight: number; explain: string }
export interface ReportV2 extends Report {
  listing: ListingV2; longestWalkMin: number
  perPerson: { people: number; total: number | null }
  fit: { score: number; parts: Record<'cost' | 'commute' | 'zone' | 'incidents', FitPart> }
  incidentFacts: { total: number; againstPerson: number; byCategory: Record<string, number> }
}
export interface RouteLeg {
  coords: [number, number][]; distanceM: number; minutes: number; pctInsideDps: number; pctLit: number
  incidents: { total: number; againstPerson: number; byCategory: Record<string, number> }
  severeIncidents: number; nightIncidents: number; riskScore: number; emergencyPhones: string[]; streets: string[]
  pctBusy: number; safetyCost: number
  darkStreetlights: { address: string; reported: string; status: string; lat: number; lng: number }[]
  openNow: { name: string; kind: string; hours: string; lat: number; lng: number }[]
}
export interface RouteWeights { incidents: number; dps: number; light: number; people: number }
export interface RouteResult {
  night: boolean; at: string; weights: RouteWeights; fastest: RouteLeg; safest: RouteLeg; sameRoute: boolean; summary: string; method: string
  parameters: { key: string; label: string; weight: number; effect: string; source: string }[]
}
export interface IncidentPoint { lat: number; lng: number; block: string; count: number; severe: number; night: number; byCategory: Record<string, number>; latest: string }
export interface IncidentsResponse { source: string; synthetic: boolean; count: number; days: number; points: IncidentPoint[] }
export interface SafetyResource { type: 'dps_station' | 'blue_phone' | 'police' | 'medical' | 'vending' | 'service'; name: string; lat: number; lng: number; operator?: string; address?: string; hours?: string; phone?: string; detail?: string; precision?: 'exact' | 'approximate'; source?: string; approximate?: boolean }
export interface DpsUnit { id: string; callsign: string; status: string; lat: number; lng: number; heading: number }
export interface CostLine { key: string; label: string; amount: number; formula: string; why: string }
export interface CostBreakdown {
  lines: CostLine[]; total: number; perPersonRent: number; people: number; ridesPerMonth: number; farePerRide: number; hiddenCost: number
  whatIf: { ifInsideFryft: number; ifOutsideFryft: number; perExtraLateNight: number }
  inputs: { rent: number; utilities: number; inFryft: boolean; priceUnit: string; unit: Unit | null }
  listing: ListingV2 | null
}
