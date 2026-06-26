import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import connect_to_supabase, get_db
connect_to_supabase()
db = get_db()

res = db.table("batches").select("*").execute()
print("All Batches in DB:")
for row in res.data or []:
    print(f"ID: {row.get('id')} | Name: {row.get('batch_name')} | Status: {row.get('status')} | Category: {row.get('category')} | Phase: {row.get('phase')} | Onboarding: {row.get('onboarding_date')}")
