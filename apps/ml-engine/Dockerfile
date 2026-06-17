FROM python:3.11-slim

WORKDIR /app

COPY apps/ml-engine/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/ml-engine/ ./

# Pre-trained LSL prior (from train_historical.py); rebuild image after retraining.
# OCR deps optional at runtime — training is offline only.

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
