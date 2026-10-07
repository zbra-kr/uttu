"""Strict adapter failures; no publication or orchestration policy."""


class DiscoveryFailure(RuntimeError):
    """Sanitized discovery failure; never a successful empty result."""
