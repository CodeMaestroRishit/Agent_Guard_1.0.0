FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV FLASK_APP=app.main FLASK_RUN_HOST=0.0.0.0 ENFORCEMENT_HMAC_KEY=changeme AGENTGUARD_PORT=5073
EXPOSE 5073
CMD ["python", "-m", "app.main"]
