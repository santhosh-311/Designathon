import os
import json
from app.core.database import get_db
from app.core.config import settings
# Force reload of settings config

SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "system_settings.json")

DEFAULT_SETTINGS = {
    "TOPPER_PERCENTAGE": settings.TOPPER_PERCENTAGE,
    "ATTENDANCE_CUTOFF_TIME": settings.ATTENDANCE_CUTOFF_TIME,
    "ABSENT_ALERT_DAYS": settings.ABSENT_ALERT_DAYS,
    "AZURE_OPENAI_API_KEY": settings.AZURE_OPENAI_API_KEY,
    "AZURE_OPENAI_ENDPOINT": settings.AZURE_OPENAI_ENDPOINT,
    "AZURE_OPENAI_DEPLOYMENT": settings.AZURE_OPENAI_DEPLOYMENT,
    "MIN_BATCH_SIZE_LIMIT": settings.MIN_BATCH_SIZE_LIMIT,
    "COORDINATOR_POOLS": {},
    "COORDINATOR_TRAINEES": {},
}

def get_all_settings() -> dict:
    """Get all system settings, trying the database first, then local JSON, then defaults."""
    # Try reading from database
    try:
        db = get_db()
        if db:
            res = db.table("system_settings").select("*").execute()
            if res.data:
                db_settings = {}
                for row in res.data:
                    k = row["key"]
                    v = row["value"]
                    if k in ["TOPPER_PERCENTAGE", "ABSENT_ALERT_DAYS", "MIN_BATCH_SIZE_LIMIT"]:
                        db_settings[k] = int(v)
                    elif k in ["COORDINATOR_POOLS", "COORDINATOR_TRAINEES"]:
                        try:
                            db_settings[k] = json.loads(v)
                        except:
                            db_settings[k] = {}
                    else:
                        db_settings[k] = v
                # Merge with default settings to ensure all exist
                merged = DEFAULT_SETTINGS.copy()
                merged.update(db_settings)
                return merged
    except Exception as e:
        # Fail silently and fallback
        pass
    
    # Try JSON file
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                file_settings = json.load(f)
                merged = DEFAULT_SETTINGS.copy()
                merged.update(file_settings)
                return merged
        except Exception:
            pass
            
    return DEFAULT_SETTINGS

def get_setting(key: str, default=None):
    """Retrieve a single setting value."""
    all_settings = get_all_settings()
    return all_settings.get(key, default)

def update_settings(new_settings: dict):
    """Update settings in database (if available), JSON, and live config."""
    # Try writing to database
    db_success = False
    try:
        db = get_db()
        if db:
            for k, v in new_settings.items():
                val_str = json.dumps(v) if isinstance(v, (dict, list)) else str(v)
                db.table("system_settings").upsert({"key": k, "value": val_str}).execute()
            db_success = True
    except Exception:
        pass
        
    # Always write to JSON file as a fallback/backup
    try:
        current = {}
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, "r") as f:
                current = json.load(f)
        current.update(new_settings)
        with open(SETTINGS_FILE, "w") as f:
            json.dump(current, f, indent=4)
    except Exception as e:
        if not db_success:
            raise e

    # Update settings object and environment variables dynamically
    if "AZURE_OPENAI_API_KEY" in new_settings:
        settings.AZURE_OPENAI_API_KEY = new_settings["AZURE_OPENAI_API_KEY"]
        os.environ["AZURE_OPENAI_API_KEY"] = new_settings["AZURE_OPENAI_API_KEY"]
    if "AZURE_OPENAI_ENDPOINT" in new_settings:
        settings.AZURE_OPENAI_ENDPOINT = new_settings["AZURE_OPENAI_ENDPOINT"]
        os.environ["AZURE_OPENAI_ENDPOINT"] = new_settings["AZURE_OPENAI_ENDPOINT"]
    if "AZURE_OPENAI_DEPLOYMENT" in new_settings:
        settings.AZURE_OPENAI_DEPLOYMENT = new_settings["AZURE_OPENAI_DEPLOYMENT"]
        os.environ["AZURE_OPENAI_DEPLOYMENT"] = new_settings["AZURE_OPENAI_DEPLOYMENT"]
    if "TOPPER_PERCENTAGE" in new_settings:
        settings.TOPPER_PERCENTAGE = int(new_settings["TOPPER_PERCENTAGE"])
    if "ATTENDANCE_CUTOFF_TIME" in new_settings:
        settings.ATTENDANCE_CUTOFF_TIME = new_settings["ATTENDANCE_CUTOFF_TIME"]
    if "ABSENT_ALERT_DAYS" in new_settings:
        settings.ABSENT_ALERT_DAYS = int(new_settings["ABSENT_ALERT_DAYS"])
    if "MIN_BATCH_SIZE_LIMIT" in new_settings:
        settings.MIN_BATCH_SIZE_LIMIT = int(new_settings["MIN_BATCH_SIZE_LIMIT"])
