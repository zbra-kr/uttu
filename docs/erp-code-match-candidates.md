# CO mapping source candidates — no confirmation or writes

Separate addendum on the preserved owned-session recovery candidate (patch e76e24afe8eaa927ac2c2ed556cee77d31649a34c190d7bcf040e45761f3b6c1; full local tree patch56675755716a3c63c4e09a17837887615de144a3a0acc9f7ab459cd941384caf). That reviewed candidate, its four files, original source11 and all earlier candidates are unchanged. No PR27 merge/deploy.

## Existing fields and exact paths

UTTU products already has id/musinsa_no/brand_id/name/style_no/erp_style_code; brands.slug supplies the catalog label. 00003_products.sql documents style_no as brand's style identifier and optional ERP hint. More precisely, existing worker/scrapers/musinsa_product.py:120 stores state.get('styleNo') directly; no new Musinsa fetch or name parser is used here. Existing ERP SW_STYLEINFO exposes BRANDCD,STYLECD,STYLENM and SW_STYLEINFO_DETAIL exposes COLORCD (existing order/receipt sources already use these). The existing MDA brand-code map labels CO as covernat; this does not replace independent brand/cardinality approval.

One bounded UTTU source query reads10 own covernat rows with nonempty style_no, using only existing product fields and a stable id order. A second query checks all products with those10 full code values in the same catalog, bounded21 plus exact count. Actual catalog count with nonempty style_no2921; samples10; peer rows10 and exact count10, complete for these full code values. This is not a whole-product dump or proof of global base-style uniqueness across colors/other codes.

First ERP query: CO plus the10 exact codes bound to STYLECD, limit41, master-key window count. Result0 rows. It would be wrong to equate these full style_no values directly to ERP STYLECD.

Second fixed ERP query: exact observed STYLECD || COLORCD equality to those10 complete codes, joining style master/detail on brand/style, with distinct observed code tuples and master-key cardinality. Result10 rows. No suffix length is guessed/removed, no case folding/whitespace repair, no product-name comparison. Names are returned only as human review context. Both queries use owned-session bound10, per-call timeout10, prior scan guard and fixed CO/code binds, and close their own connection. No transaction/customer fields or data writes.

## Actual dry-run result

Final local classification of the already read receipts: candidates10, conflicts0, unmatched0, confirmed0, insights0, writes0. STYLECD-only matches0; observed STYLECD+COLORCD code-equality candidates10. No new reads occur during classification. The initial color transport probe did not classify composite matches; its original diagnostic is retained as color-read-transport-original.json and final counts live in classification-result.json.

Each candidate keeps source product fields and actual ERP fields, exact equality method, and pending requirements. It is NOT a new CrosswalkEvidence/confirmed DTO. All are confirmed=false and insight_eligible=false. Duplicate catalog full-code peers, master duplicates, multiple observed compositions, multiple sampled products per ERP base style, stale conflicting ERP hints or incomplete reads are conflicts. Missing code/absent exact ERP match remains unmatched. Names never determine a candidate.

The existing unchanged inspectProductCrosswalk is also executed locally against the real product sample with no approved evidence input: accepted0, excluded10, PRODUCT_KEYS_MISSING10. is_own=true comes from the actual fixed product query predicate. Missing products.erp_style_code and absent reviewed evidence remain blockers. The existing eight-field confirmed mapping contract is not regenerated, weakened or automatically populated.

## Confirmation remains separate

Before any candidate could enter the existing confirmed path: independently review catalog brand_id <-> ERP CO binding; approve that the observed style+color composition denotes the intended product; verify global one-ERP-style/one-product cardinality (other colors/products may exist outside these exact10 codes); resolve any one-to-many policy rather than changing it implicitly; approve existing evidenceRef/version; obtain separate product-key write/evidence storage approval if accepted. No candidate JSON can automatically write erp_style_code or authorize insights. The existing eight-field confirmed DTO and sales comparison are style-level, whereas these composite codes identify observed style/color variants. Exact concatenation does not authorize comparing all-color style sales to one color product rank; the color-vs-style sales/market grain policy must also be reviewed. No new color field or confirmed DTO is introduced here. Zero conflicts here means only in this bounded observed scope.

## Evidence and verification

worker/matchers/erp_code_candidates.py implements existing source reads and candidate classification; tests7 cover direct and observed composite paths without confirmation, duplicate product/master/composition/base-style collisions, no name/suffix/case/whitespace repair, incomplete/hint conflicts, invalid scope before factory, and actual fixed query/timeout/close behavior over supplied synthetic driver. Ruff passes. Real sources were read only in the bounded calls above; tests/classification do not recollect. Existing confirmed-mapping exclusion check is offline and uses the previously reviewed adapter unchanged.

Local evidence folder erp-mapping-evidence contains product-sample.json, erp-master-sample.json, erp-color-code-sample.json, code-match-candidates.json, final classification-result.json and existing-crosswalk-exclusion.json. They contain bounded existing product/master keys/names for review, never credentials/customer/transaction records. No full product dump, new external collection, key extraction/copy, mapping DB write, permission/schema/schedule change, source branch push or deployment. Migration/cron: none. Candidate source base remains PR26 plus reviewed patches; no new commit.
