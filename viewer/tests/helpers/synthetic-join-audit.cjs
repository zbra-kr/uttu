// Test-only declaration for existing canonical fixtures. It is not live evidence.
// Caller-created joinAudit is never replaced, including missing/invalid contents.
module.exports = function withSyntheticJoinAudit(p, request) {
  if (!p || typeof p !== 'object' || Object.hasOwn(p,'joinAudit')) return p;
  const sourceTable={shopInventory:'SW_SHOPINV',warehouseInventory:'SW_WHINV',receipts:'SW_WHININFO'}[p.name];
  if (!sourceTable) return p;
  const count=Array.isArray(p.rows)?p.rows.length:0;
  return {...p,joinAudit:{version:'master-style-join-v1',masterTable:'SW_STYLEINFO',sourceTable,joinKeys:['STYLECD'],request:structuredClone(request??p.request),complete:true,evidenceRef:'SYNTHETIC_ONLY',sourceRows:count,matchedSourceRows:count,unmatchedSourceRows:0,excludedSourceRows:0,emittedRows:count,multiplicityExcessRows:0,duplicateMasterKeys:0,conflictingBrandKeys:0,unknownBrandRows:0}};
};
