import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import connect_to_supabase, get_db
connect_to_supabase()
db = get_db()

res = db.table("batches").select("*").execute()
for row in res.data or []:
    # Check if batch_id matches or is substring or description has it
    b_id = row.get("id")
    b_name = row.get("batch_name")
    print(f"Batch Name: {b_name}, ID: {b_id}")
    for k, v in row.items():
        if "D0A0FBE4" in str(v) or "d0a0fbe4" in str(v):
            print(f"  FOUND in key {k}: {v}")
