"""Compatibility classification only; no baseline or persistence confirmation."""

LEGACY_RANK_RULES = frozenset({
    "rank_spike", "rank_drop_own", "new_entrant_top10", "rank_return_own",
    "rank_exit_own", "rank_multi_drop_own", "brand_rank_drop_own",
    "brand_rank_spike_competitor", "brand_new_entrant_top10",
    "brand_exit_top50_own", "brand_rank_gender_diverge",
})


def valid_rank(value):
    return type(value) is int and value > 0


def urgent_notification_eligible(anomaly):
    version = anomaly.meta.get("policy_version")
    return not (
        anomaly.anomaly_type in LEGACY_RANK_RULES
        and version in {None, "legacy-rank-noise-v1"}
    )
