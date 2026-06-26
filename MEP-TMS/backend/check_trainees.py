import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from app.core.database import connect_to_supabase, get_db
connect_to_supabase()
db = get_db()

res = db.table("trainee_pool").select("*").eq("onboarding_date", "2026-06-25").execute()
emails = [r["email"] for r in res.data or []]

# Check candidates table for both batches
spark_uuid = "be89e2f9-ec29-4a51-8c5d-04228a7ef2bb"
found_uuid = "22fdddb8-e48a-4b72-8988-0ee5d8b5989b"

spark_cands = db.table("candidates").select("*").eq("batch_id", spark_uuid).execute()
found_cands = db.table("candidates").select("*").eq("batch_id", found_uuid).execute()

print(f"Candidates in Spark 1 batch ({spark_uuid}): {len(spark_cands.data)}")
print(f"Candidates in Foundational batch ({found_uuid}): {len(found_cands.data)}")

# Check report cards in spark_1_report_cards
rc_res = db.table("spark_1_report_cards").select("*").in_("email", emails).execute()
print(f"Report cards in spark_1_report_cards: {len(rc_res.data)}")
rc_final_status = {}
for row in rc_res.data:
    st = row.get("final_status")
    rc_final_status[st] = rc_final_status.get(st, 0) + 1
print("Report card statuses:")
for st, count in rc_final_status.items():
    print(f"  - {st}: {count}")
