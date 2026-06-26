import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import connect_to_supabase, get_db
connect_to_supabase()
db = get_db()

res = db.table("spark_1_report_cards").select("*").limit(3).execute()
print("Sample Report Cards:")
if res.data:
    for row in res.data:
        print(row)
else:
    print("No records found in spark_1_report_cards")
