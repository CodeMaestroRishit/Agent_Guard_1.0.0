from pydantic import BaseModel, Field

class PolicyRule(BaseModel):
    roles: list[str] = Field(default_factory=list)
    tool_id: str
    effect: str = "BLOCK"
    conditions: dict = Field(default_factory=dict)
    reason: str = "rule"
