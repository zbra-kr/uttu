import { inspectJoinCoverage } from './join-coverage';
import { observedSchemaIssues } from './observed-schema-boundary';
import { ERP_BRANDS, requestReason } from '../erp-insight-workspace';
import { validCSDate } from '../cs-daily-review-check';
import { blocked, type SalesInventoryRequest, type SalesInventoryState, type Observation, type ReadReason } from './sales-inventory-types';

export const PARTITIONS = ['sales', 'shopInventory', 'warehouseInventory', 'mapping', 'market'] as const;
export type PartitionName = typeof PARTITIONS[number];
export interface Partition {
  name: PartitionName; complete: boolean; pagesExpected: number; pagesReceived: number;
  source: string; grain: string; fetchedAt: string; asOf: string;
  definition: string; request: SalesInventoryRequest; rows: unknown[];
}
// Exact projection contract for a future provider, not a claim about a live schema.
export const CONTRACTS: Record<PartitionName, { source: string; grain: string; definition: string }> = {
  sales: { source: 'verified-option-sales-projection', grain: 'SALEDT|BRANDCD|STYLECD|SHOPCD|COLORCD|SIZECD', definition: 'vat-excluded-signed-KRW-preserve-decimal-v1' },
  shopInventory: { source: 'verified-shop-inventory-projection', grain: 'BRANDCD|STYLECD|SHOPCD|COLORCD|SIZECD', definition: 'shop-snapshot-v1' },
  warehouseInventory: { source: 'verified-warehouse-inventory-projection', grain: 'BRANDCD|STYLECD|WHCD|COLORCD|SIZECD', definition: 'warehouse-snapshot-v1' },
  mapping: { source: 'verified-product-crosswalk', grain: 'BRANDCD|STYLECD', definition: 'one-to-one-category-crosswalk-v1' },
  market: { source: 'ranking_snapshots', grain: 'product_id|snapshot_date|store_code|category_code|gender_filter|age_filter', definition: 'observed-rank-not-sales-v1' },
};
export const CENTRAL_SALES_CONTRACT = { source:'verified-central-sales-projection', grain:'SALEDT|BRANDCD|STYLECD|SHOPCD', definition:'canonical-vat-excluded-central-sales-v2' } as const;
const seasons = { SS: ['봄', '여름', '상반기', '스탠다드'], FW: ['가을', '겨울', '하반기', '스탠다드'] };
const transfers = new Set(['B6055', 'B6057', 'B6063']);
function obj(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x); }
function text(x: unknown): x is string { return typeof x === 'string' && x.length > 0 && x.length <= 160 && x === x.trim(); }
function decimal(x: unknown): x is string { return typeof x === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(x) && x.length <= 40; }
function integer(x: unknown): x is string { return typeof x === 'string' && /^-?(?:0|[1-9]\d*)$/.test(x) && x.length <= 30; }
function date(x: unknown) { if (typeof x !== 'string' || !/^\d{8}$/.test(x)) return null; const d = `${x.slice(0,4)}-${x.slice(4,6)}-${x.slice(6)}`; return validCSDate(d) ? d : null; }
function same(a: unknown, b: unknown): boolean {
  if (!obj(a) || !obj(b)) return false;
  return ['brand','from','to','year','season','inventoryAsOf'].every(k => a[k] === b[k]) && obj(a.market) && obj(b.market) && ['store','category','gender','age'].every(k => (a.market as Record<string, unknown>)[k] === (b.market as Record<string, unknown>)[k]);
}
export function validReadRequest(q: unknown): q is SalesInventoryRequest {
  return obj(q) && requestReason(q) === null && ERP_BRANDS.includes(q.brand as typeof ERP_BRANDS[number]) && q.inventoryAsOf === q.to && obj(q.market) && ['store','category','gender','age'].every(k => text((q.market as Record<string,unknown>)[k]));
}
export function normalizeSalesInventory(input: unknown, request: SalesInventoryRequest): SalesInventoryState {
  if (!validReadRequest(request)) return blocked('withheld','INVALID_REQUEST');
  if (!Array.isArray(input)) return blocked('withheld','INCOMPLETE');
  // Collect only fixed reason codes. Present rows are validated even when another
  // partition is empty/incomplete; no raw rows or diagnostics leave this boundary.
  const coverage = inspectJoinCoverage(input, request);
  const issues = new Set<ReadReason>(coverage.reasons);
  if (input.length !== PARTITIONS.length) issues.add('INCOMPLETE');
  const byName = new Map<PartitionName, Record<string,unknown>>();
  for (const p of input) {
    for (const code of observedSchemaIssues(p)) issues.add(code);
    if (!obj(p) || !PARTITIONS.includes(p.name as PartitionName) || byName.has(p.name as PartitionName)) { issues.add('INCOMPLETE'); continue; }
    byName.set(p.name as PartitionName,p);
    if (p.complete !== true || !Number.isSafeInteger(p.pagesExpected) || Number(p.pagesExpected) < 1 || p.pagesExpected !== p.pagesReceived || !Array.isArray(p.rows)) issues.add('INCOMPLETE');
    if (Array.isArray(p.rows) && p.rows.length === 0) issues.add('EMPTY');
    const c = p.name === 'sales' && p.source === CENTRAL_SALES_CONTRACT.source ? CENTRAL_SALES_CONTRACT : CONTRACTS[p.name as PartitionName];
    if (p.source !== c.source || p.grain !== c.grain || p.definition !== c.definition || !same(p.request, request)
      || p.asOf !== request.to || typeof p.fetchedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(p.fetchedAt) || !Number.isFinite(Date.parse(p.fetchedAt)) || !validCSDate(p.fetchedAt.slice(0,10)) || new Date(p.fetchedAt).toISOString().replace('.000','') !== p.fetchedAt || p.fetchedAt.slice(0,10) < request.to) issues.add('CONTRACT');
  }
  for (const name of PARTITIONS) if (!byName.has(name)) issues.add('INCOMPLETE');
  const rows = (name: PartitionName): unknown[] => Array.isArray(byName.get(name)?.rows) ? byName.get(name)!.rows as unknown[] : [];
  const centralSales = byName.get('sales')?.source === CENTRAL_SALES_CONTRACT.source;
  const result = new Map<string, Observation>(); const products = new Set<string>(); const musinsa = new Set<string>();
  for (const raw of rows('mapping')) {
    if (!obj(raw) || raw.BRANDCD !== request.brand || !text(raw.STYLECD) || !text(raw.productId) || !text(raw.musinsaNo) || raw.isOwn !== true || raw.category !== request.market.category || !text(raw.crosswalkVersion) || !text(raw.verificationReceipt)) { issues.add('MAPPING'); continue; }
    if (result.has(raw.STYLECD) || products.has(raw.productId) || musinsa.has(raw.musinsaNo)) { issues.add('MAPPING'); continue; }
    products.add(raw.productId);musinsa.add(raw.musinsaNo);
    result.set(raw.STYLECD,{ brand:request.brand,style:raw.STYLECD,productId:raw.productId,musinsaNo:raw.musinsaNo,from:request.from,to:request.to,inventoryAsOf:request.inventoryAsOf,sales:[],shops:[],warehouses:[],market:null as unknown as Observation['market'],orders:null,receipts:null });
  }
  for (const name of ['sales','shopInventory','warehouseInventory'] as const) {
    const seen = new Set<string>();
    for (const raw of rows(name)) {
      if (!obj(raw) || raw.BRANDCD !== request.brand || !text(raw.STYLECD) || (!(name === 'sales' && centralSales) && (!text(raw.COLORCD) || !text(raw.SIZECD))) || raw.YEARCD !== request.year || !seasons[request.season].includes(raw.SEASONNM as string)) { issues.add('INVALID_ROW'); continue; }
      if (name === 'sales' && centralSales && (Object.hasOwn(raw,'COLORCD') || Object.hasOwn(raw,'SIZECD'))) { issues.add('CENTRAL_GRAIN_UNVERIFIED'); continue; }
      const location = name === 'warehouseInventory' ? raw.WHCD : raw.SHOPCD;
      const day = name === 'sales' ? date(raw.SALEDT) : request.inventoryAsOf;
      if (!text(location) || !day || day < request.from || day > request.to) { issues.add('INVALID_ROW'); continue; }
      const key = JSON.stringify([day,raw.BRANDCD,raw.STYLECD,location,centralSales && name==='sales' ? null : raw.COLORCD,centralSales && name==='sales' ? null : raw.SIZECD]);
      if (seen.has(key)) { issues.add('INVALID_ROW'); continue; } seen.add(key);
      const validValues = name === 'sales' ? decimal(raw.SALEAMT_VAT_EX) && integer(raw.SALEQTY)
        : name === 'shopInventory' ? integer(raw.INVQTY) && integer(raw.AVAILQTY)
        : integer(raw.AVAILQTY) && integer(raw.ONLINEQTY) && integer(raw.OFFLINEQTY);
      if (!validValues) { issues.add('INVALID_ROW'); continue; }
      const row = result.get(raw.STYLECD);
      if (!row) { if (rows('mapping').length) issues.add('MAPPING'); continue; }
      if (name === 'sales') {
        if (!transfers.has(location)) row.sales.push({date:day,shop:location,color:centralSales ? null : raw.COLORCD as string,size:centralSales ? null : raw.SIZECD as string,vatExcludedKRW:raw.SALEAMT_VAT_EX as string,quantity:raw.SALEQTY as string});
      } else if (name === 'shopInventory') {
        row.shops.push({shop:location,color:raw.COLORCD as string,size:raw.SIZECD as string,inventory:raw.INVQTY as string,available:raw.AVAILQTY as string});
      } else {
        row.warehouses.push({warehouse:location,color:raw.COLORCD as string,size:raw.SIZECD as string,available:raw.AVAILQTY as string,online:raw.ONLINEQTY as string,offline:raw.OFFLINEQTY as string});
      }
    }
  }
  const ranks = new Map<string, Map<string,number>>();
  for (const raw of rows('market')) {
    if (!obj(raw) || !text(raw.STYLECD)) { issues.add('MAPPING'); continue; }
    if (raw.snapshot_date !== request.from && raw.snapshot_date !== request.to || !Number.isSafeInteger(raw.rank_position) || Number(raw.rank_position) <= 0) { issues.add('INVALID_ROW'); continue; }
    if (raw.BRANDCD !== request.brand || raw.store_code !== request.market.store || raw.category_code !== request.market.category || raw.gender_filter !== request.market.gender || raw.age_filter !== request.market.age || !text(raw.product_id) || !text(raw.musinsa_no)) { issues.add('MAPPING'); continue; }
    const mapped = result.get(raw.STYLECD);
    if (!mapped) { if (rows('mapping').length) issues.add('MAPPING'); continue; }
    if (raw.product_id !== mapped.productId || raw.musinsa_no !== mapped.musinsaNo) { issues.add('MAPPING'); continue; }
    const days = ranks.get(raw.STYLECD) ?? new Map<string,number>();
    if (days.has(raw.snapshot_date as string)) { issues.add('INVALID_ROW'); continue; } days.set(raw.snapshot_date as string,raw.rank_position as number);ranks.set(raw.STYLECD,days);
  }
  // An empty partition is not an invalid row, but must not mask actual row errors.
  // Derived per-product completeness is checked only after source checks pass.
  if (issues.size === 0) for (const row of result.values()) {
    const rank = ranks.get(row.style);
    if (!row.sales.length || !row.shops.length || !row.warehouses.length || !rank?.has(request.from) || !rank.has(request.to)) { issues.add('INCOMPLETE'); continue; }
    row.market = {fromRank:rank.get(request.from)!,toRank:rank.get(request.to)!,from:request.from,to:request.to,scope:{...request.market}};
  }
  if (issues.size) {
    const reasons = [...issues].sort() as ReadReason[];
    return {kind: issues.size === 1 && issues.has('EMPTY') ? 'empty' : 'withheld', observations:[],coverage:coverage.summaries,reasons,executable:false};
  }
  return {kind:'ready',observations:[...result.values()],coverage:coverage.summaries,reasons:[],executable:false};
}
