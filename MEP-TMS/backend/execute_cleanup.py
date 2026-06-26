import os
from dotenv import load_dotenv
from supabase import create_client
import redis as redis_lib

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

def get_count(table):
    try:
        res = supabase.table(table).select("count", count="exact").execute()
        return res.count or 0
    except Exception as e:
        return f"Error: {e}"

def print_counts(label):
    tables = [
        "users", "batches", "candidates", "attendances", "assessments",
        "detailed_feedbacks", "feedbacks", "spark_1_report_cards",
        "spark_2_report_cards", "foundation_report_cards", "stream_report_cards",
        "trainee_pool", "gamification_ledger", "notifications"
    ]
    print(f"\n--- {label} Record Counts ---")
    for t in tables:
        print(f"  {t}: {get_count(t)}")

def delete_all_from(table):
    """Delete all rows from a table via Supabase REST API."""
    try:
        # PostgREST requires a filter for DELETE. Use a tautology filter.
        res = supabase.table(table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        count = len(res.data) if res.data else 0
        print(f"  Deleted {count} rows from '{table}'")
        return True
    except Exception as e:
        print(f"  Error deleting from '{table}': {e}")
        return False

def run_cleanup():
    print_counts("PRE-CLEANUP")
    
    print("\n=== EXECUTING CLEANUP ===")
    
    # Step 1: Delete child tables first (respecting FK constraints)
    # Report cards reference both candidates and batches
    print("\n[Step 1] Deleting report cards...")
    delete_all_from("spark_1_report_cards")
    delete_all_from("spark_2_report_cards")
    delete_all_from("foundation_report_cards")
    delete_all_from("stream_report_cards")
    
    # Step 2: Delete attendance, assessments, feedbacks (reference candidates and batches)
    print("\n[Step 2] Deleting attendances, assessments, feedbacks...")
    delete_all_from("attendances")
    delete_all_from("assessments")
    delete_all_from("feedbacks")
    delete_all_from("detailed_feedbacks")
    
    # Step 3: Delete candidates (references batches)
    print("\n[Step 3] Deleting candidates...")
    delete_all_from("candidates")
    
    # Step 4: Delete batches (no more children now)
    print("\n[Step 4] Deleting batches...")
    delete_all_from("batches")
    
    # Step 5: Delete trainee_pool
    print("\n[Step 5] Deleting trainee_pool...")
    delete_all_from("trainee_pool")
    
    # Step 6: Delete gamification_ledger
    print("\n[Step 6] Deleting gamification_ledger...")
    delete_all_from("gamification_ledger")
    
    # Step 7: Delete TRAINEE users only
    print("\n[Step 7] Deleting TRAINEE users...")
    try:
        res = supabase.table("users").delete().eq("role", "TRAINEE").execute()
        count = len(res.data) if res.data else 0
        print(f"  Deleted {count} TRAINEE users")
    except Exception as e:
        print(f"  Error deleting TRAINEE users: {e}")
    
    # Step 8: Delete notifications (orphaned ones)
    print("\n[Step 8] Cleaning up notifications...")
    delete_all_from("notifications")
    
    # Step 9: Flush Redis cache
    redis_url = os.getenv("REDIS_URL")
    if redis_url:
        print("\n[Step 9] Flushing Redis cache keys (mep:*)...")
        try:
            client = redis_lib.from_url(redis_url, decode_responses=True)
            keys = client.keys("mep:*")
            if keys:
                deleted = client.delete(*keys)
                print(f"  Deleted {deleted} Redis cache keys")
            else:
                print("  No cache keys found (already clean)")
        except Exception as e:
            print(f"  Redis flush error: {e}")
    
    # Post-cleanup verification
    print_counts("POST-CLEANUP")
    
    # Show remaining users
    print("\n--- Remaining Users ---")
    try:
        res = supabase.table("users").select("full_name, email, role").execute()
        for u in res.data or []:
            print(f"  {u['role']}: {u['full_name']} ({u['email']})")
        print(f"\nTotal remaining users: {len(res.data or [])}")
    except Exception as e:
        print(f"  Error: {e}")

if __name__ == "__main__":
    run_cleanup()
