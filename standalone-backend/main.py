import os
from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from config import API_SECRET_TOKEN, TEMP_DIR, CUSTOMER_CONFIGS
from report_engine import fill_excel_template, convert_excel_to_pdf, merge_final_report_pdf

app = FastAPI(title="PLN Report Automation Service", version="16.5")

class GenerateReportRequest(BaseModel):
    customer_id: str
    customer_name: Optional[str] = ""
    tariff_power: Optional[str] = ""
    period_text: Optional[str] = ""
    meter_stand_awal_lwbp: float = 0.0
    meter_stand_akhir_lwbp: float = 0.0
    meter_stand_awal_wbp: float = 0.0
    meter_stand_akhir_wbp: float = 0.0
    meter_stand_awal_kvarh: float = 0.0
    meter_stand_akhir_kvarh: float = 0.0
    lwbp_amount: float = 0.0
    wbp_amount: float = 0.0
    kvarh_amount: float = 0.0
    total_amount: float = 0.0
    stamp_fee: float = 10000.0
    total_payment: float = 0.0
    technician_name: Optional[str] = ""
    signature_image_path: Optional[str] = None
    invoice_pdf_path: Optional[str] = None
    template_path: Optional[str] = None

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "pln-report-engine", "version": "16.5"}

@app.post("/api/v1/generate-report")
async def generate_report(payload: GenerateReportRequest, x_api_token: str = Header(None)):
    if x_api_token != API_SECRET_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized: Token API tidak valid")
    
    cid = payload.customer_id
    if cid not in CUSTOMER_CONFIGS:
        raise HTTPException(status_code=400, detail=f"Customer ID {cid} tidak terdaftar di sistem")
    
    cfg = CUSTOMER_CONFIGS[cid]
    base_prefix = cfg["prefix"]
    
    template_file = payload.template_path or f"/opt/pln-report-service/templates/{cfg['key']}_template.xlsx"
    if not os.path.exists(template_file):
        raise HTTPException(status_code=500, detail=f"File template Excel tidak ditemukan: {template_file}")
    
    out_xlsx = os.path.join(TEMP_DIR, f"{base_prefix}_DRAFT.xlsx")
    final_merged_pdf = os.path.join(TEMP_DIR, f"{base_prefix}_FINAL.pdf")
    
    try:
        # Step 1: Isi Excel & Formula
        fill_excel_template(template_file, payload.model_dump(), out_xlsx)
        
        # Step 2: Konversi ke PDF via LibreOffice
        report_pdf = convert_excel_to_pdf(out_xlsx, TEMP_DIR)
        
        # Step 3: Gabungkan dengan Invoice asli jika ada
        if payload.invoice_pdf_path and os.path.exists(payload.invoice_pdf_path):
            merge_final_report_pdf(report_pdf, payload.invoice_pdf_path, final_merged_pdf)
            output_final = final_merged_pdf
        else:
            output_final = report_pdf
            
        return {
            "ok": True,
            "status": "COMPLETED",
            "customer_key": cfg["key"],
            "pdf_path": output_final,
            "file_size": os.path.getsize(output_final)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report generation error: {str(e)}")
