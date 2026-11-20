"""JSON helpers shared by the HTTP API and the CLI: numpy -> python, NaN/inf -> null."""
from __future__ import annotations

import math
from typing import Any

import numpy as np


def clean(obj: Any) -> Any:
    """Recursively convert numpy to python and NaN/inf to None."""
    if isinstance(obj, np.ndarray):
        return clean(obj.tolist())
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, np.generic):
        return clean(obj.item())
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    return obj
