# Dockerfile — CivicGuide
# Builds a minimal Python image for Google Cloud Run
# No pip installs needed — uses only the standard library

FROM python:3.12-slim

WORKDIR /app

# Copy server and all static files
COPY server.py .
COPY public/ ./public/

# Cloud Run injects PORT automatically; expose it
ENV PORT=8080
EXPOSE 8080

CMD ["python", "server.py"]