from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SalesRow(BaseModel):
    date: str
    hour: int
    sales_amount: float


class RoleBand(BaseModel):
    from_: str = Field(alias="from")
    to: str
    cashiers: int = 0
    cooks: int = 0
    packliners: int = 0

    model_config = {"populate_by_name": True, "extra": "ignore"}


class Preferences(BaseModel):
    labourCostPct: float = 0.2
    avgHourlyWage: float = 18.5
    shiftLengthHours: float = 8
    constraints: dict[str, Any] = Field(default_factory=dict)
    jobCodeMapping: dict[str, str] = Field(default_factory=dict)


class OperatingHoursDay(BaseModel):
    open: str = "10:00"
    close: str = "22:00"
    closed: bool = False


class OperatingHours(BaseModel):
    default: OperatingHoursDay = Field(default_factory=lambda: OperatingHoursDay())
    byDay: dict[str, OperatingHoursDay] = Field(default_factory=dict)


class Employee(BaseModel):
    user_id: str
    role: str
    roles: list[str] = Field(default_factory=list)
    experience_level: str = "Intermediate"
    shift_tier: str = "Rush-capable"
    min_hours: float | None = None
    max_hours: float | None = None
    min_shifts_per_week: int | None = None
    max_shifts_per_week: int | None = None
    pairing_always_with: list[str] = Field(default_factory=list)
    pairing_never_with: list[str] = Field(default_factory=list)


class AvailabilityBlock(BaseModel):
    user_id: str
    day_of_week: int
    start_time: str
    end_time: str


class TimeOff(BaseModel):
    user_id: str
    start_date: str
    end_date: str


class AvailabilitySubmission(BaseModel):
    user_id: str
    status: str


class GenerateRequest(BaseModel):
    workplace_id: str
    week_start: str
    sales: list[SalesRow]
    preferences: Preferences
    operating_hours: OperatingHours
    role_requirements: dict[str, list[RoleBand]] = Field(default_factory=dict)
    employees: list[Employee] = Field(default_factory=list)
    availability: list[AvailabilityBlock] = Field(default_factory=list)
    approved_time_off: list[TimeOff] = Field(default_factory=list)
    availability_submissions: list[AvailabilitySubmission] = Field(default_factory=list)


class WorkersNeededHour(BaseModel):
    date: str
    hour: int
    sales: float
    workers: int


class WorkersNeededDay(BaseModel):
    date: str
    sales: float
    workers: int


class WorkersNeeded(BaseModel):
    byHour: list[WorkersNeededHour]
    byDay: list[WorkersNeededDay]


class RoleDemandHour(BaseModel):
    date: str
    hour: int
    cashiers: int
    cooks: int
    packliners: int


class ShiftOut(BaseModel):
    employeeId: str
    day: str
    shiftDate: str
    startTime: str
    endTime: str
    role: str
    location: str = "Main"


class FlagOut(BaseModel):
    type: str
    date: str | None = None
    hour: int | None = None
    message: str | None = None


class GenerateResponse(BaseModel):
    status: str = "draft"
    workersNeeded: WorkersNeeded
    roleDemandByHour: list[RoleDemandHour] = Field(default_factory=list)
    shifts: list[ShiftOut]
    flags: list[FlagOut]
    engineVersion: str = "2.0.0"
