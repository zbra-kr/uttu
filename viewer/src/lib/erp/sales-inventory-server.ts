import 'server-only';
import { PARTITIONS, normalizeSalesInventory, validReadRequest, type PartitionName } from './sales-inventory-normalize';
import { blocked, type SalesInventoryRequest, type SalesInventoryState } from './sales-inventory-types';

// Implemented by a reviewed existing server/worker transport later. No credential,
// SQL execution, service_role client, environment lookup or default transport here.
export interface ErpReadProvider {
  readPartition(name: PartitionName, request: SalesInventoryRequest): Promise<unknown>;
}
export interface ErpReadAccess {
  authorize(request: SalesInventoryRequest): Promise<boolean>;
  // Verify source schema/definitions/receipt using trusted server configuration.
  // This is deliberately separate from provider-supplied assertions.
  verify(partitions: readonly unknown[], request: SalesInventoryRequest): Promise<boolean>;
}
export async function readSalesInventory(request: unknown, provider: ErpReadProvider | null, access: ErpReadAccess | null): Promise<SalesInventoryState> {
  if (!provider) return blocked('unconnected','UNCONNECTED');
  if (!validReadRequest(request)) return blocked('withheld','INVALID_REQUEST');
  if (!access) return blocked('withheld','ACCESS_DENIED');
  try {
    const captured = structuredClone(request);
    if (await access.authorize(structuredClone(captured)) !== true) return blocked('withheld','ACCESS_DENIED');
    const settled = await Promise.allSettled(PARTITIONS.map(name => provider.readPartition(name, structuredClone(captured))));
    if (settled.some(p => p.status === 'rejected')) return blocked('error','READ_FAILED');
    const partitions = settled.map(p => (p as PromiseFulfilledResult<unknown>).value);
    if (await access.verify(partitions, structuredClone(captured)) !== true) return blocked('withheld','CONTRACT');
    return normalizeSalesInventory(partitions,captured);
  } catch { return blocked('error','READ_FAILED'); }
}

// Actual review-page path. No provider is configured; real injection must pass
// both server access checks and verified partitions through readSalesInventory.
export async function readConfiguredSalesInventory(): Promise<SalesInventoryState> {
  return readSalesInventory(null,null,null);
}
