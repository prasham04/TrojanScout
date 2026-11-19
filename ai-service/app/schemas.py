"""Shared contracts (section 7.8). Keep in sync with frontend/src/api/types.ts."""
from typing import Literal

from pydantic import BaseModel, Field


class Priorities(BaseModel):
    cost: float = 0.4
    commute: float = 0.3
    zone: float = 0.2
    incidents: float = 0.1


class Profile(BaseModel):
    budget: int = 1500
    buildingIds: list[int] = Field(default_factory=list)
    lateNights: int = 2
    priorities: Priorities = Field(default_factory=Priorities)


class Filters(BaseModel):
    maxRent: int | None = None
    beds: int | None = None
    inFryft: bool | None = None
    inDps: bool | None = None
    buildingIds: list[int] = Field(default_factory=list)
    maxCommuteMin: int | None = None


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    profile: Profile = Field(default_factory=Profile)
    history: list[ChatTurn] = Field(default_factory=list)


class Citation(BaseModel):
    n: int
    source: str
    date: str
    url: str


class BlockSummary(BaseModel):
    summary: str
    incidents6mo: dict[str, int] = Field(default_factory=dict)
    citations: list[Citation] = Field(default_factory=list)


Intent = Literal["search", "ask_about_listing", "general", "need_info", "named"]
