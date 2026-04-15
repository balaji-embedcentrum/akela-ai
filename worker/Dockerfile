FROM python:3.12-slim
WORKDIR /app
COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Copy worker and api (worker imports from api models)
COPY worker/ ./worker/
COPY api/ ./api/
ENV PYTHONPATH=/app
CMD ["python", "worker/main.py"]
