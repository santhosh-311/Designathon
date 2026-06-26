from dotenv import load_dotenv
import os
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")

try:
    print(f"Connecting to Supabase at {url}...")
    supabase = create_client(url, key)
    
    tables = [
        "users",
        "batches",
        "candidates",
        "attendances",
        "assessments",
        "feedbacks",
        "trainee_pool",
        "notifications"
    ]
    
    print("\n--- Table Record Counts ---")
    for t in tables:
        try:
            res = supabase.table(t).select("count", count="exact").execute()
            print(f"Table '{t}': {res.count} records")
        except Exception as e:
            print(f"Table '{t}': Error: {e}")
            
    # Let's inspect users by role
    print("\n--- Users list (all roles) ---")
    try:
        res = supabase.table("users").select("id, email, full_name, role, is_active").execute()
        roles_count = {}
        for u in res.data or []:
            r = u.get('role')
            roles_count[r] = roles_count.get(r, 0) + 1
            print(f"  User: {u.get('full_name')} ({u.get('email')}) | Role: {r} | Active: {u.get('is_active')}")
        print("\nSummary by Role:")
        for r, c in roles_count.items():
            print(f"  {r}: {c}")
    except Exception as e:
        print(f"Error listing users: {e}")
        
    # Let's inspect batches
    print("\n--- Batches ---")
    try:
        res = supabase.table("batches").select("id, batch_id, batch_name, status").execute()
        for r in res.data or []:
            print(f"  Batch: {r.get('batch_name')} ({r.get('batch_id')}) | Status: {r.get('status')}")
    except Exception as e:
        print(f"Error listing batches: {e}")

except Exception as e:
    print("Supabase Connection/Execution Error:", e)
