FROM python:3.12-slim
WORKDIR /app
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Copy entire project so api/ package is at /app/api/
COPY api/ ./api/
ENV PYTHONPATH=/app
CMD ["python", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8200"]
