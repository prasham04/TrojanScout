"""AI check for student "suspicious activity" reports before they're shown to anyone.

The model decides whether a report is a usable safety report: specific about what happened, where and when, about
behaviour (not someone's race, appearance or who they are), not spam, a joke or harassment of a person, and with no
private details (names, phone numbers, plates of bystanders). It returns a cleaned, factual one-line summary.

Severity is hard-coded to "danger" for now (product decision for the demo); the model's own estimate is kept as
`modelSeverity` so it can be switched on later.
"""
from __future__ import annotations

import json
import re

from pydantic import BaseModel, Field

from app.llm import get_llm

PROFILING = re.compile(r"\b(black|white|hispanic|latino|latina|asian|arab|mexican|homeless|ghetto|thug|illegal)\b", re.I)
PRIVATE = re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|@\w+\.\w+")


class Verdict(BaseModel):
    valid: bool = Field(description="True if this is a genuine, specific safety report about behaviour at a place and time")
    reasons: list[str] = Field(default_factory=list, description="Short reasons, especially why it was rejected or what's missing")
    summary: str = Field("", description="One neutral, factual sentence describing what happened (no names, no appearance)")
    category: str = Field("Other", description="One of: Suspicious behaviour, Harassment, Theft / break-in, Assault, Following someone, Weapon seen, Other")
    modelSeverity: str = Field("caution", description="low, caution or danger")


PROMPT = """You review safety reports from university students before they are shown to other students near USC.
Accept a report only if it describes specific BEHAVIOUR (what someone did) at a place and roughly when.
Reject it if it: describes a person by race, ethnicity, appearance, clothing or housing status without describing a behaviour;
is spam, a joke, an advertisement, a personal dispute or an attack on a named person; or has no safety content.
Rewrite accepted reports as one neutral, factual sentence with no names, phone numbers or appearance details.
Reply with JSON only: {{"valid": bool, "reasons": [str], "summary": str, "category": str, "modelSeverity": "low"|"caution"|"danger"}}

Category given by the student: {category}
Where: {where}
When: {when}
Report: {text}"""


def _rules(text: str) -> list[str]:
    problems = []
    if len(text.strip()) < 15:
        problems.append("Too short: say what happened.")
    if PROFILING.search(text):
        problems.append("Describe what the person did, not their race, appearance or housing status.")
    if PRIVATE.search(text):
        problems.append("Remove phone numbers or emails.")
    return problems


async def check_report(text: str, category: str, where: str, when: str) -> dict:
    problems = _rules(text)
    v = Verdict(valid=not problems, reasons=problems, summary=text.strip()[:200], category=category or "Other")
    llm = get_llm()
    checked_by = "rules"
    if llm is not None:
        try:
            out = await llm.ainvoke(PROMPT.format(category=category, where=where, when=when, text=text[:1000]))
            raw = out.content if isinstance(out.content, str) else json.dumps(out.content)
            m = re.search(r"\{.*\}", raw, re.S)
            if m:
                got = Verdict(**json.loads(m.group(0)))
                v = Verdict(valid=got.valid and not problems, reasons=[*problems, *got.reasons][:4],
                            summary=got.summary or v.summary, category=got.category or v.category, modelSeverity=got.modelSeverity)
                checked_by = "ai"
        except Exception:
            pass  # rules-only verdict
    return {**v.model_dump(), "severity": "danger", "checkedBy": checked_by}
