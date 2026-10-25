"""Small, dependency-free descriptive intervals for training reports."""

import math


def wilson_interval(successes, trials, z=1.959963984540054):
    """Return a two-sided Wilson interval for a binomial proportion."""
    if not 0 <= successes <= trials:
        raise ValueError("Success count must be between zero and the trial count")
    if trials == 0:
        return None
    proportion = successes / trials
    denominator = 1 + z**2 / trials
    center = (proportion + z**2 / (2 * trials)) / denominator
    radius = (
        z
        * math.sqrt(proportion * (1 - proportion) / trials + z**2 / (4 * trials**2))
        / denominator
    )
    return [max(0.0, center - radius), min(1.0, center + radius)]
