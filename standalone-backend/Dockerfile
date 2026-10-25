FROM python:3.11-slim

# Install LibreOffice headless, fonts, and curl for health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-calc \
    fonts-liberation \
    fonts-dejavu-core \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PLN_TEMP_DIR=/tmp/pln_reports
RUN mkdir -p /tmp/pln_reports /opt/pln-report-service/templates

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
