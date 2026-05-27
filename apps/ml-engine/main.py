from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="ShiftWise ML Engine",
    description="Demand forecasting and schedule assignment service",
    version="0.1.0",
)


class GenerateRequest(BaseModel):
    workplace_id: str
    week_start: str
    schedule_id: str | None = None


@app.get("/health")
def health():
    return {"status": "ok", "service": "shiftwise-ml-engine"}


@app.post("/generate")
def generate(request: GenerateRequest):
    # Plan 2: real demand + assignment. Plan 1 API uses in-process stub if this returns not_implemented.
    return {
        "status": "not_implemented",
        "message": "Scheduling engine — see Plan 2",
        "workplace_id": request.workplace_id,
        "week_start": request.week_start,
    }
