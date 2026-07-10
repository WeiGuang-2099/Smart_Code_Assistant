"""Regression gate: compare aggregate metrics against configured floors.

The thresholds file is JSON with up to three sections::

    {
      "overall":    {"hit_rate@5": 0.9, "mrr": 0.7},   # floors on aggregate.overall
      "generation": {"faithfulness": 4.0},              # floors on aggregate.generation
      "max_errors": 0                                   # ceiling on aggregate.overall.errors
    }

A metric named in the config but absent from the results counts as a
violation - a renamed or dropped metric must not silently pass the gate.
"""
import json
from numbers import Real
from pathlib import Path

_ALLOWED_KEYS = ("overall", "generation", "max_errors")


class GateConfigError(ValueError):
    """Thresholds file is missing, unparseable, or malformed."""


def _validate_floors(section: str, floors: object) -> None:
    if not isinstance(floors, dict):
        raise GateConfigError(f"'{section}' must be an object of metric -> floor")
    for name, floor in floors.items():
        if isinstance(floor, bool) or not isinstance(floor, Real):
            raise GateConfigError(
                f"'{section}.{name}' floor must be a number, got {floor!r}"
            )


def load_thresholds(path: Path) -> dict:
    """Read and validate a thresholds JSON file. Raises GateConfigError."""
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise GateConfigError(f"thresholds file not found: {path}") from None
    try:
        thresholds = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GateConfigError(f"invalid JSON in {path}: {exc}") from None

    if not isinstance(thresholds, dict):
        raise GateConfigError("thresholds root must be a JSON object")
    unknown = [k for k in thresholds if k not in _ALLOWED_KEYS]
    if unknown:
        raise GateConfigError(
            f"unknown key(s) {unknown} - allowed: {list(_ALLOWED_KEYS)}"
        )

    for section in ("overall", "generation"):
        if section in thresholds:
            _validate_floors(section, thresholds[section])
    if "max_errors" in thresholds:
        max_errors = thresholds["max_errors"]
        if isinstance(max_errors, bool) or not isinstance(max_errors, int) or max_errors < 0:
            raise GateConfigError(
                f"'max_errors' must be a non-negative integer, got {max_errors!r}"
            )

    has_check = (
        thresholds.get("overall") or thresholds.get("generation")
        or "max_errors" in thresholds
    )
    if not has_check:
        raise GateConfigError("no thresholds defined - the gate would check nothing")
    return thresholds


def _check_floors(section: str, block: dict, floors: dict) -> list[str]:
    failures = []
    for name, floor in floors.items():
        value = block.get(name)
        if value is None:
            failures.append(f"{section}.{name}: missing from results (floor {floor})")
        elif value < floor:
            failures.append(f"{section}.{name}: {value} is below floor {floor}")
    return failures


def check_thresholds(aggregate: dict, thresholds: dict) -> list[str]:
    """Return one message per violated threshold; empty list means the gate passes."""
    failures: list[str] = []
    overall = aggregate.get("overall", {})

    if "overall" in thresholds:
        failures += _check_floors("overall", overall, thresholds["overall"])

    if "max_errors" in thresholds:
        errors = overall.get("errors", 0)
        if errors > thresholds["max_errors"]:
            failures.append(
                f"overall.errors: {errors} exceeds max_errors {thresholds['max_errors']}"
            )

    if "generation" in thresholds:
        gen = aggregate.get("generation")
        if gen is None:
            floors = sorted(thresholds["generation"])
            failures.append(
                f"generation: section missing from results (floors set for {floors})"
            )
        else:
            failures += _check_floors("generation", gen, thresholds["generation"])

    return failures
