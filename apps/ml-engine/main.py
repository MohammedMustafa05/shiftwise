from fastapi import FastAPI
from pydantic import ValidationError

from engine import generate_schedule
from schemas import GenerateRequest, GenerateResponse

app = FastAPI(
    title="ShiftWise ML Engine",
    description="Demand forecasting and schedule assignment service",
    version="2.0.0",
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "shiftwise-ml-engine", "version": "2.0.0"}


@app.post("/generate", response_model=GenerateResponse)
def generate(request: GenerateRequest) -> GenerateResponse:
    return generate_schedule(request)
