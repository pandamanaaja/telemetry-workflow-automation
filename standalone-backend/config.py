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
    "543100000001": {
        "key": "JOGLO",
        "name": "Broadcaster Client A (TV Network)",
        "doc_code": "ST.JOGLO-PLN-IVM",
        "prefix": "IVM_JOGLO_PEMBAYARAN_PLN",
        "drive_folder_id": os.getenv("FOLDER_JOGLO", "YOUR_CUSTOMER_JOGLO_FOLDER_ID")
    },
    "543100000002": {
        "key": "MUSTOFA",
        "name": "Commercial Partner C",
        "doc_code": "",
        "prefix": "IVM_Panjang_Permohonan Pembayaran_PLN H.Mustofa",
        "drive_folder_id": os.getenv("FOLDER_MUSTOFA", "YOUR_CUSTOMER_MUSTOFA_FOLDER_ID")
    },
    "543100000003": {
        "key": "SCTV",
        "name": "Broadcaster Client B (National Broadcast)",
        "doc_code": "",
        "prefix": "SCTV_Panjang_Permohonan Pembayaran_PLN",
        "has_hitung": True,
        "drive_folder_id": os.getenv("FOLDER_SCTV", "YOUR_CUSTOMER_SCTV_FOLDER_ID")
    },
    "543100000004": {
        "key": "BEKASI",
        "name": "Media Conglomerate Holding",
        "doc_code": "BEKASI-PLN-IVM",
        "prefix": "EMTEK_Bekasi_Permohonan Pembayaran PLN",
        "drive_folder_id": os.getenv("FOLDER_BEKASI", "YOUR_CUSTOMER_BEKASI_FOLDER_ID")
    },
    "543100000005": {
        "key": "HAMBALANG",
        "name": "Media Conglomerate Holding",
        "doc_code": "",
        "prefix": "EMTEK_Hambalang_Permohonan Pembayaran PLN",
        "drive_folder_id": os.getenv("FOLDER_HAMBALANG", "YOUR_CUSTOMER_HAMBALANG_FOLDER_ID")
    }
}
