"""Spec section 20: the claim sheet. Everything the series supports, as one JSON object."""
from __future__ import annotations

from . import analysis as A
from . import limits as L
from . import metrics as K
from . import readback as RB
from . import requirements as R
from .series import Model


def report(model: Model) -> dict:
    s = model.series
    lim = s.limits
    return {
        "series": {"name": s.name, "analyte": s.analyte, "units": s.units, "signalLabel": s.signal_label,
                   "mode": s.mode, "cMax": model.c_max, "whatIf": model.adjust_params},
        **A.overview(model),
        "levels": model.levels,
        "rows": K.level_rows(model),
        "limits": L.limits(model, lim.alpha, lim.beta, lim.cv, lim.reads, profile=False),
        "limitsData": L.limits_data(model, lim.alpha, lim.beta),
        "requirements": R.check(model),
        "readback": RB.readback(model) if s.samples else None,
    }
