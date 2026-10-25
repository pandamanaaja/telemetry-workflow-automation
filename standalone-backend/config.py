import os
from pydantic import BaseModel
from typing import Dict, Optional

API_SECRET_TOKEN = os.getenv("PLN_API_SECRET_TOKEN", "YOUR_STANDALONE_API_SECRET_TOKEN")
TIMEZONE = "Asia/Jakarta"
SERVICE_ACCOUNT_FILE = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "/opt/pln-report-service/credentials/service_account.json")

TEMP_DIR = os.getenv("PLN_TEMP_DIR", "/tmp/pln_reports")
os.makedirs(TEMP_DIR, exist_ok=True)

DEFAULT_STAMP = 10000

CUSTOMER_CONFIGS: Dict[str, dict] = {
    "543104053078": {
        "key": "JOGLO",
        "name": "INDOSIAR VISUAL M PT",
        "doc_code": "ST.JOGLO-PLN-IVM",
        "prefix": "IVM_JOGLO_PEMBAYARAN_PLN",
        "drive_folder_id": os.getenv("FOLDER_JOGLO", "YOUR_CUSTOMER_JOGLO_FOLDER_ID")
    },
    "543103684326": {
        "key": "MUSTOFA",
        "name": "H MUSTOFA",
        "doc_code": "",
        "prefix": "IVM_Panjang_Permohonan Pembayaran_PLN H.Mustofa",
        "drive_folder_id": os.getenv("FOLDER_MUSTOFA", "YOUR_CUSTOMER_MUSTOFA_FOLDER_ID")
    },
    "548400528183": {
        "key": "SCTV",
        "name": "PT. SCTV",
        "doc_code": "",
        "prefix": "SCTV_Panjang_Permohonan Pembayaran_PLN",
        "has_hitung": True,
        "drive_folder_id": os.getenv("FOLDER_SCTV", "YOUR_CUSTOMER_SCTV_FOLDER_ID")
    },
    "537420834389": {
        "key": "BEKASI",
        "name": "PT ELANG MAHKOTA TEKNOLOG",
        "doc_code": "BEKASI-PLN-IVM",
        "prefix": "EMTEK_Bekasi_Permohonan Pembayaran PLN",
        "drive_folder_id": os.getenv("FOLDER_BEKASI", "YOUR_CUSTOMER_BEKASI_FOLDER_ID")
    },
    "538613957435": {
        "key": "HAMBALANG",
        "name": "PT ELANG MAHKOTA TEKNOLOG",
        "doc_code": "",
        "prefix": "EMTEK_Hambalang_Permohonan Pembayaran PLN",
        "drive_folder_id": os.getenv("FOLDER_HAMBALANG", "YOUR_CUSTOMER_HAMBALANG_FOLDER_ID")
    }
}
