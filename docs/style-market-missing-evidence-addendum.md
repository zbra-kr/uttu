# Missing-evidence addendum — local only

Reviewed grain patch `182e1c7762f15aa219acb712865d4ed29b8f849be93f6ed0f344b7c3b2f6657a` is preserved. This separate change adds a pure recorded-calendar audit validator and threads its explicit source-view-zero evidence into the offline review grouping. Existing source-positive rows and unproven partial inputs retain their prior behavior. No source truth/authentication is inferred from a JSON receipt; this remains offline evidence, not an activated runtime adapter.

## Bounded hypothesis checks

* Fifteen newly linked exact full codes: direct ERP STYLECD lookup returned zero; together with the earlier ten, all 25 now have direct-path coverage. No confirmation follows.
* Two missing color codes: exact equality across all catalog brands/ownership returned zero for both, excluding the previous own-brand predicate as the cause. 165 own Covernat catalog products have missing style_no. Those keyless records cannot be attributed to either color: product absence versus a missing/alternate code remains unresolved. No name/substring guess or product write was made.
* One fixed style/calendar LEFT JOIN query returned all 140 combinations for the ten styles and 14 days. 64 positive source/day rows match the previous rows exactly (counts and numeric amount); 76 combinations have COUNT(source STYLECD)=0, COUNT(amount)=0 and SUM=NULL; no positive-row NULL amount exists. The query and source guards are recorded in missing-evidence/read-snowflake.py and snowflake-evidence.json. A generated zero has actual sourceRows=0, never a fabricated transaction count. The source-view snapshot is complete; upstream ingestion completeness is UNKNOWN, so neither no real-world sale nor no collection omission is asserted.
* For the fixed 25 products, all-filter ranking counts are 14 lifetime, 8 in October 1–14, and 0 on October 7 or 14. The bounded metadata query captured all 14 records: other dates, categories and demographic scopes exist. Thus target endpoints are absent regardless of category; scope substitution/interpolation is not performed.

## Display and validation

Styles still own one all-color total each; children carry market evidence only. The 76 proved source-view zero days permit ten complete filtered-view style summaries, with zero-day count and unknown upstream completeness explicitly visible. Rank endpoints remain missing, mappings unconfirmed, allocation NONE, insights zero. Calendar validator rejects partial/duplicate/wrong-scope receipts and inconsistent zero audits, and retains real source NULL as held. New tests 4 plus existing display regression tests 5 passed in one invocation; targeted type compile and lint passed. Full app build and deployment were not run.

No DB data writes, schema/ACL changes, new collection, publication, environment or original candidate edits. Owned Snowflake session timeout 10 seconds, driver timeout 10, fixed query scan budget, sentinel cap and SDK closure were retained. Remaining ambiguity and exact audit counts are recorded in missing-evidence/result.json.
