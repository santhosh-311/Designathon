from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks
from typing import List
from app.schemas.schemas import (
    BatchCreate, BatchUpdate, BatchResponse, 
    CandidateCreate, CandidateResponse, CandidateStatusUpdate,
    AttendanceBatchResponse, CurriculumGenerateRequest,
    CurriculumSuggestionResponse
)
from app.core.database import get_db
from app.core.security import get_current_user, has_role, hash_password
from app.models.models import Batch, Candidate, BatchStatus, row_to_api
from app.services.email_service import EmailService
import uuid
import json
import secrets
import string
from datetime import datetime

router = APIRouter(prefix="/api/batch", tags=["batch"])

def get_next_employee_id(db) -> str:
    try:
        # Fetch existing registration numbers matching 'MAV-%'
        res = db.table("candidates").select("registration_number").like("registration_number", "MAV-%").execute()
        max_val = 0
        if res.data:
            for row in res.data:
                reg_num = row.get("registration_number", "")
                if reg_num.startswith("MAV-"):
                    try:
                        num_part = reg_num.split("-")[1]
                        num = int(num_part)
                        if num > max_val:
                            max_val = num
                    except (IndexError, ValueError):
                        continue
        next_val = max_val + 1
        return f"MAV-{next_val:03d}"
    except Exception as e:
        print(f"Error generating next employee id: {e}")
        try:
            res = db.table("candidates").select("id", count="exact").like("registration_number", "MAV-%").execute()
            count = res.count if hasattr(res, 'count') else (len(res.data) if res.data else 0)
            return f"MAV-{(count + 1):03d}"
        except Exception:
            import random
            return f"MAV-{random.randint(100, 999)}"

def generate_temp_password() -> str:
    # 2 uppercase, 4 lowercase, 2 digits
    up = "".join(secrets.choice(string.ascii_uppercase) for _ in range(2))
    low = "".join(secrets.choice(string.ascii_lowercase) for _ in range(4))
    dig = "".join(secrets.choice(string.digits) for _ in range(2))
    return up + low + dig

@router.post("/create", response_model=BatchResponse)
async def create_batch(batch_data: BatchCreate, background_tasks: BackgroundTasks, current_user: dict = Depends(has_role("ADMIN", "COORDINATOR"))):
    """Create a new batch"""
    db = get_db()
    
    batch = Batch(
        batchId=f"BATCH-{uuid.uuid4().hex[:8].upper()}",
        batchName=batch_data.batchName,
        startDate=batch_data.startDate,
        endDate=batch_data.endDate,
        trainers=batch_data.trainers,
        description=batch_data.description,
        topics=batch_data.topics,
        sizeLimit=batch_data.sizeLimit,
        questions=batch_data.questions
    )
    
    result = db.table("batches").insert(batch.to_dict()).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create batch")
        
    created_batch_data = result.data[0]
    batch_uuid = created_batch_data["id"]

    # Log BATCH_CREATED if created by Coordinator
    if current_user.get("role") == "COORDINATOR":
        try:
            db.table("notifications").insert({
                "type": "BATCH_CREATED",
                "message": f"New batch '{batch_data.batchName}' created by Coordinator {current_user.get('fullName', 'User')}.",
                "is_read": False,
                "created_at": datetime.utcnow().isoformat()
            }).execute()
        except Exception as notif_err:
            print(f"[Warn] Failed to create BATCH_CREATED notification: {notif_err}")
    
    # Process trainees list if provided
    trainees_count = 0
    if hasattr(batch_data, "trainees") and batch_data.trainees:
        for trainee in batch_data.trainees:
            email = trainee.email.strip()
            fullName = trainee.fullName.strip()
            
            # Check if user already exists
            existing_user = db.table("users").select("*").eq("email", email).execute()
            if existing_user.data:
                # User already exists
                user_row = existing_user.data[0]
                user_id = user_row["id"]
                current_batches = user_row.get("assigned_batches", []) or []
                if batch_uuid not in current_batches:
                    current_batches.append(batch_uuid)
                    db.table("users").update({"assigned_batches": current_batches}).eq("id", user_id).execute()
                
                # Check if they are already mapped as a candidate in this batch
                existing_cand = db.table("candidates").select("*").eq("email", email).eq("batch_id", batch_uuid).execute()
                if not existing_cand.data:
                    # Find existing employee id or generate new
                    cand_res = db.table("candidates").select("registration_number").eq("email", email).execute()
                    if cand_res.data:
                        emp_id = cand_res.data[0]["registration_number"]
                    else:
                        emp_id = get_next_employee_id(db)
                        
                    candidate = Candidate(
                        email=email,
                        fullName=fullName,
                        registrationNumber=emp_id,
                        batchId=batch_uuid
                    )
                    db.table("candidates").insert(candidate.to_dict()).execute()
                    trainees_count += 1
            else:
                # User is new, create user with role TRAINEE
                emp_id = get_next_employee_id(db)
                temp_password = generate_temp_password()
                password_hash = hash_password(temp_password)
                
                new_user = {
                    "email": email,
                    "full_name": fullName,
                    "password_hash": password_hash,
                    "role": "TRAINEE",
                    "assigned_batches": [batch_uuid],
                    "is_active": True
                }
                
                user_insert = db.table("users").insert(new_user).execute()
                
                # Insert candidate mapping
                candidate = Candidate(
                    email=email,
                    fullName=fullName,
                    registrationNumber=emp_id,
                    batchId=batch_uuid
                )
                db.table("candidates").insert(candidate.to_dict()).execute()
                trainees_count += 1
                
                # Send credentials onboarding email via background task
                background_tasks.add_task(
                    EmailService.send_trainee_credentials,
                    candidate_email=email,
                    candidate_name=fullName,
                    employee_id=emp_id,
                    temp_password=temp_password
                )
                
        # Update batches count in batches table
        if trainees_count > 0:
            db.table("batches").update({"candidates_count": trainees_count}).eq("id", batch_uuid).execute()
            # Also update returned response dict
            created_batch_data["candidates_count"] = trainees_count
            
    created_batch = row_to_api(created_batch_data)
    return BatchResponse(**created_batch)

@router.get("/list", response_model=List[BatchResponse])
async def list_batches(current_user: dict = Depends(get_current_user)):
    """Get all batches"""
    db = get_db()
    
    result = db.table("batches").select("*").execute()
    return [BatchResponse(**row_to_api(batch)) for batch in result.data]

@router.get("/{batch_id}", response_model=BatchResponse)
async def get_batch(batch_id: str, current_user: dict = Depends(get_current_user)):
    """Get batch by ID"""
    db = get_db()
    
    try:
        result = db.table("batches").select("*").eq("id", batch_id).execute()
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Batch not found"
            )
        return BatchResponse(**row_to_api(result.data[0]))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{batch_id}", response_model=BatchResponse)
async def update_batch(batch_id: str, batch_data: BatchUpdate, current_user: dict = Depends(has_role("ADMIN", "COORDINATOR"))):
    """Update batch"""
    db = get_db()
    
    try:
        # Fetch current batch to get existing description
        existing = db.table("batches").select("*").eq("id", batch_id).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Batch not found"
            )
        
        current_batch_row = existing.data[0]
        current_desc_str = current_batch_row.get("description")
        
        existing_questions = []
        if current_desc_str:
            try:
                parsed = json.loads(current_desc_str)
                if isinstance(parsed, dict):
                    existing_text = parsed.get("text", current_desc_str)
                    existing_topics = parsed.get("topics", [])
                    existing_size_limit = parsed.get("sizeLimit")
                    existing_questions = parsed.get("questions", [])
            except Exception:
                existing_text = current_desc_str
        
        raw = batch_data.model_dump(exclude_unset=True)
        
        updated_text = raw.get("description", existing_text)
        updated_topics = raw.get("topics", existing_topics)
        updated_size_limit = raw.get("sizeLimit", existing_size_limit)
        updated_questions = raw.get("questions", existing_questions)
        
        updated_desc_json = {
            "text": updated_text,
            "topics": updated_topics,
            "sizeLimit": updated_size_limit,
            "questions": updated_questions
        }
        updated_desc_str = json.dumps(updated_desc_json)
        
        update_data = {}
        field_map = {
            "batchName": "batch_name",
            "startDate": "start_date",
            "endDate": "end_date",
        }
        
        for key, value in raw.items():
            if key in ["description", "topics", "sizeLimit", "questions"]:
                continue
            db_key = field_map.get(key, key)
            if isinstance(value, datetime):
                update_data[db_key] = value.isoformat()
            elif hasattr(value, 'value'):  # Enum
                update_data[db_key] = value.value
            else:
                update_data[db_key] = value
        
        # Always set description to the updated serialized JSON string
        update_data["description"] = updated_desc_str
        
        old_status = current_batch_row.get("status")
        new_status = raw.get("status")
        new_status_val = new_status.value if hasattr(new_status, 'value') else new_status

        result = db.table("batches").update(update_data).eq("id", batch_id).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Batch not found"
            )
            
        # Log BATCH_STATUS_CHANGED if status changed
        if new_status_val and old_status != new_status_val:
            try:
                db.table("notifications").insert({
                    "type": "BATCH_STATUS_CHANGED",
                    "message": f"Batch '{current_batch_row.get('batch_name', 'Unknown')}' status changed from {old_status} to {new_status_val}.",
                    "is_read": False,
                    "created_at": datetime.utcnow().isoformat()
                }).execute()
            except Exception as status_err:
                print(f"[Warn] Failed to create BATCH_STATUS_CHANGED notification: {status_err}")
        
        return BatchResponse(**row_to_api(result.data[0]))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{batch_id}")
async def delete_batch(batch_id: str, current_user: dict = Depends(has_role("ADMIN", "COORDINATOR"))):
    """Delete batch"""
    db = get_db()
    
    try:
        # Delete associated data first (cascade should handle this, but being explicit)
        db.table("assessments").delete().eq("batch_id", batch_id).execute()
        db.table("attendances").delete().eq("batch_id", batch_id).execute()
        db.table("candidates").delete().eq("batch_id", batch_id).execute()
        
        result = db.table("batches").delete().eq("id", batch_id).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Batch not found"
            )
        
        return {"message": "Batch deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{batch_id}/candidates", response_model=CandidateResponse)
async def add_candidate(batch_id: str, candidate_data: CandidateCreate, current_user: dict = Depends(has_role("COORDINATOR", "TRAINER"))):
    """Add candidate to batch"""
    db = get_db()
    
    try:
        # Check if batch exists
        batch_result = db.table("batches").select("id").eq("id", batch_id).execute()
        if not batch_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Batch not found"
            )
        
        candidate = Candidate(
            email=candidate_data.email,
            fullName=candidate_data.fullName,
            registrationNumber=f"REG-{uuid.uuid4().hex[:6].upper()}",
            batchId=batch_id,
            phone=candidate_data.phone
        )
        
        result = db.table("candidates").insert(candidate.to_dict()).execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to add candidate")
        
        # Update batch candidate count
        batch = db.table("batches").select("candidates_count").eq("id", batch_id).execute()
        current_count = batch.data[0]["candidates_count"] if batch.data else 0
        db.table("batches").update({"candidates_count": current_count + 1}).eq("id", batch_id).execute()
        
        created_candidate = row_to_api(result.data[0])
        return CandidateResponse(**created_candidate)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{batch_id}/candidates", response_model=List[CandidateResponse])
async def get_batch_candidates(batch_id: str, current_user: dict = Depends(get_current_user)):
    """Get all candidates in a batch"""
    db = get_db()
    
    result = db.table("candidates").select("*").eq("batch_id", batch_id).execute()
    
    candidates_list = []
    if result.data:
        # Fetch users with matching email to resolve their active status
        emails = [c["email"] for c in result.data if c.get("email")]
        users_res = db.table("users").select("email, is_active").in_("email", emails).execute()
        user_active_map = {u["email"]: u.get("is_active", True) for u in users_res.data} if users_res.data else {}
        
        for c in result.data:
            api_c = row_to_api(c)
            api_c["isActive"] = user_active_map.get(c.get("email"), True)
            candidates_list.append(CandidateResponse(**api_c))
            
    return candidates_list

@router.delete("/{batch_id}/candidates/{candidate_id}")
async def delete_candidate(
    batch_id: str,
    candidate_id: str,
    current_user: dict = Depends(has_role("COORDINATOR"))
):
    """Delete candidate from a batch (Coordinator only)"""
    db = get_db()
    
    try:
        # 1. Fetch candidate to get their email
        cand_result = db.table("candidates").select("*").eq("id", candidate_id).eq("batch_id", batch_id).execute()
        if not cand_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Candidate not found in this batch"
            )
        candidate_data = cand_result.data[0]
        email = candidate_data.get("email")

        # 2. Delete candidate row
        db.table("candidates").delete().eq("id", candidate_id).execute()

        # 3. Decrement candidates_count in batches table
        batch_res = db.table("batches").select("candidates_count").eq("id", batch_id).execute()
        current_count = batch_res.data[0]["candidates_count"] if batch_res.data else 0
        db.table("batches").update({"candidates_count": max(0, current_count - 1)}).eq("id", batch_id).execute()

        # 4. Remove batch_id from user's assigned_batches list
        if email:
            user_res = db.table("users").select("*").eq("email", email).execute()
            if user_res.data:
                u_data = user_res.data[0]
                u_id = u_data["id"]
                current_batches = u_data.get("assigned_batches", []) or []
                if batch_id in current_batches:
                    current_batches.remove(batch_id)
                    db.table("users").update({"assigned_batches": current_batches}).eq("id", u_id).execute()

        return {"message": "Candidate deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{batch_id}/candidates/{candidate_id}/status")
async def update_candidate_status(
    batch_id: str,
    candidate_id: str,
    status_data: CandidateStatusUpdate,
    current_user: dict = Depends(has_role("COORDINATOR"))
):
    """Update candidate's active status (Coordinator only)"""
    db = get_db()
    
    try:
        # 1. Fetch candidate to get their email
        cand_result = db.table("candidates").select("email").eq("id", candidate_id).eq("batch_id", batch_id).execute()
        if not cand_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Candidate not found in this batch"
            )
        email = cand_result.data[0].get("email")

        # 2. Update status of corresponding user
        if not email:
            raise HTTPException(status_code=400, detail="Candidate email is missing, cannot update status")
            
        user_res = db.table("users").select("id").eq("email", email).execute()
        if not user_res.data:
            raise HTTPException(status_code=404, detail="Corresponding user account not found")

        u_id = user_res.data[0]["id"]
        db.table("users").update({
            "is_active": status_data.isActive,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", u_id).execute()

        return {"message": f"Candidate status updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{batch_id}/attendance-summary", response_model=List[AttendanceBatchResponse])
async def get_batch_attendance_summary(batch_id: str, current_user: dict = Depends(get_current_user)):
    """Get attendance summary for batch"""
    db = get_db()
    
    try:
        # Fetch total candidate count for the batch
        candidates_res = db.table("candidates").select("id").eq("batch_id", batch_id).execute()
        total_candidates = len(candidates_res.data) if candidates_res.data else 0
        
        result = db.table("attendances").select("*").eq("batch_id", batch_id).execute()
        attendances = result.data
        
        # Group by date
        date_summary = {}
        for attendance in attendances:
            # Parse date and get just the date portion
            att_date = attendance["date"]
            if isinstance(att_date, str):
                date_key = att_date[:10]  # Get YYYY-MM-DD
            else:
                date_key = att_date.date().isoformat()
            
            if date_key not in date_summary:
                date_summary[date_key] = {
                    "date": attendance["date"],
                    "presentCount": 0,
                    "absentCount": 0,
                    "leaveCount": 0
                }
            
            att_status = attendance["status"]
            if att_status == "PRESENT":
                date_summary[date_key]["presentCount"] += 1
            elif att_status == "LEAVE":
                date_summary[date_key]["leaveCount"] += 1
        
        # Calculate true absentCount dynamically for each date
        for date_key, summary in date_summary.items():
            summary["absentCount"] = max(0, total_candidates - summary["presentCount"] - summary["leaveCount"])
            
        return [AttendanceBatchResponse(**summary) for summary in date_summary.values()]
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/generate-curriculum", response_model=CurriculumSuggestionResponse)
async def generate_curriculum(
    req: CurriculumGenerateRequest,
    current_user: dict = Depends(has_role("ADMIN", "COORDINATOR"))
):
    """Generate topics and subtopics for a batch based on its name using Gemini 2.5 Flash via Langchain"""
    from app.core.config import settings
    from langchain_google_genai import ChatGoogleGenerativeAI
    from pydantic import BaseModel, Field
    
    # Check Gemini API key
    if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your_gemini_api_key_here" or settings.GEMINI_API_KEY.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is not configured. Please add GEMINI_API_KEY to your .env file."
        )
        
    prompt = f"""You are a senior technical curriculum designer. Your task is to design a high-quality, comprehensive course curriculum based on the batch name.
   
    Batch Name: {req.batchName}
   
    Requirements:
    1. Generate exactly {req.topicsCount} distinct topic groups.
    2. For each topic group, generate exactly {req.subtopicsCount} comprehensive subtopics.
    3. Make sure the topics are ordered logically for learning.
    """
    
    try:
        # Define internal schema matching schemas.py structures for output validation
        class AI_TopicSuggestion(BaseModel):
            topic: str = Field(description="The title of the curriculum topic")
            subtopics: List[str] = Field(description=f"Exactly {req.subtopicsCount} subtopics")

        class AI_CurriculumSuggestionResponse(BaseModel):
            curriculum: List[AI_TopicSuggestion] = Field(description=f"List of exactly {req.topicsCount} topics")
            
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=settings.GEMINI_API_KEY,
            temperature=0.3
        )
        
        structured_llm = llm.with_structured_output(AI_CurriculumSuggestionResponse)
        response = await structured_llm.ainvoke(prompt)
        
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI curriculum generation failed: {str(e)}")

