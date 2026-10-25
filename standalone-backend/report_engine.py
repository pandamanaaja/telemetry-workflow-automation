import os
import subprocess
import openpyxl
from openpyxl.drawing.image import Image
from pypdf import PdfWriter, PdfReader
from config import TEMP_DIR, DEFAULT_STAMP

def fill_excel_template(template_path: str, data: dict, output_path: str):
    """
    Mengisi template Excel (.xlsx) dengan data OCR dan hasil komputasi matematis.
    """
    wb = openpyxl.load_workbook(template_path)
    ws_tn = wb["TN"] if "TN" in wb.sheetnames else wb.active
    
    # Isi informasi dasar
    ws_tn["B4"] = data.get("customer_name", "")
    ws_tn["B5"] = data.get("customer_id", "")
    ws_tn["B6"] = data.get("tariff_power", "")
    
    # Isi tanggal periode tagihan
    ws_tn["C12"] = data.get("period_text", "")
    
    # Isi angka meteran
    ws_tn["E16"] = float(data.get("meter_stand_awal_lwbp", 0))
    ws_tn["F16"] = float(data.get("meter_stand_akhir_lwbp", 0))
    ws_tn["E17"] = float(data.get("meter_stand_awal_wbp", 0))
    ws_tn["F17"] = float(data.get("meter_stand_akhir_wbp", 0))
    ws_tn["E18"] = float(data.get("meter_stand_awal_kvarh", 0))
    ws_tn["F18"] = float(data.get("meter_stand_akhir_kvarh", 0))
    
    # Isi rincian rupiah pembayaran
    ws_tn["G27"] = float(data.get("lwbp_amount", 0))
    ws_tn["G28"] = float(data.get("wbp_amount", 0))
    ws_tn["G29"] = float(data.get("kvarh_amount", 0))
    ws_tn["G30"] = float(data.get("total_amount", 0))
    ws_tn["G31"] = float(data.get("stamp_fee", DEFAULT_STAMP))
    ws_tn["G32"] = float(data.get("total_payment", 0))
    
    # Tempel tanda tangan teknisi jika file PNG tersedia
    sig_path = data.get("signature_image_path")
    if sig_path and os.path.exists(sig_path):
        img = Image(sig_path)
        img.width = 102
        img.height = 65
        ws_tn.add_image(img, "D36")
    
    wb.save(output_path)
    return output_path

def convert_excel_to_pdf(excel_path: str, output_dir: str = TEMP_DIR) -> str:
    """
    Konversi Excel (.xlsx) ke PDF menggunakan LibreOffice Headless via native process.
    Eksekusi lokal cepat (~1.2 detik).
    """
    cmd = [
        "libreoffice",
        "--headless",
        "--convert-to", "pdf",
        "--outdir", output_dir,
        excel_path
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Gagal konversi LibreOffice: {result.stderr}")
    
    base_name = os.path.splitext(os.path.basename(excel_path))[0]
    pdf_path = os.path.join(output_dir, f"{base_name}.pdf")
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"Hasil file PDF tidak ditemukan di: {pdf_path}")
    return pdf_path

def merge_final_report_pdf(report_pdf_path: str, invoice_pdf_path: str, output_path: str) -> str:
    """
    Menggabungkan Halaman 1-3 dari Laporan (TN, PERBANDINGAN, SCTV HITUNG)
    dengan PDF Invoice PLN asli menggunakan PyPDF secara lokal.
    """
    writer = PdfWriter()
    
    # 1. Baca PDF Laporan internal (TN, PERBANDINGAN, HITUNG)
    report_reader = PdfReader(report_pdf_path)
    for page in report_reader.pages:
        writer.add_page(page)
        
    # 2. Baca PDF Invoice PLN asli
    invoice_reader = PdfReader(invoice_pdf_path)
    for page in invoice_reader.pages:
        writer.add_page(page)
        
    with open(output_path, "wb") as f_out:
        writer.write(f_out)
        
    return output_path
