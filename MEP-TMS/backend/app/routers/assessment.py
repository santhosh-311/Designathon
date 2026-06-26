from fastapi import APIRouter, HTTPException, status, Depends
from typing import List, Optional
from datetime import datetime
from app.schemas.schemas import (
    AssessmentCreate, AssessmentUpdate, AssessmentResponse,
    BatchReportResponse, BatchResponse, AssessmentWindowStatus
)
from app.core.database import get_db
from app.core.security import get_current_user, has_role, check_batch_access, check_candidate_access, check_assessment_access
from app.models.models import Assessment, AssessmentResult, row_to_api
from app.services.topper_service import TopperService
from pydantic import BaseModel, Field

class MCQQuestion(BaseModel):
    question: str = Field(description="The multiple choice question text")
    options: List[str] = Field(description="Exactly 4 options for the question")
    correctAnswer: str = Field(description="The correct answer, which MUST be a string copied exactly from one of the options in the options list. Character-for-character matching is required.")

class MCQTopicGroup(BaseModel):
    topic: str = Field(description="The name of the topic group")
    questions: List[MCQQuestion] = Field(description="Exactly 3 challenging multiple-choice questions (MCQs)")

class AssessmentQuestionsSchema(BaseModel):
    topics: List[MCQTopicGroup] = Field(description="List of assessment questions grouped by topic")

router = APIRouter(prefix="/api/assessment", tags=["assessment"])

@router.post("/create", response_model=AssessmentResponse)
async def create_assessment(
    assessment_data: AssessmentCreate,
    current_user: dict = Depends(has_role("TRAINER", "COORDINATOR", "TRAINEE"))
):
    """Create assessment record"""
    db = get_db()
    check_batch_access(db, current_user, assessment_data.batchId)
    if current_user.get("role") == "TRAINEE":
        check_candidate_access(db, current_user, assessment_data.candidateId)
    
    # Check if batch is CLOSED
    batch_res = db.table("batches").select("*").eq("id", assessment_data.batchId).execute()
    if batch_res.data:
        from app.routers.batch import sync_batch_status
        batch = sync_batch_status(db, batch_res.data[0])
        if batch.get("status") == "CLOSED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot create assessment for a CLOSED batch."
            )
    
    # Enforce attempt limit (maximum 2 attempts) for trainees
    if current_user.get("role") == "TRAINEE":
        base_name = assessment_data.assessmentName
        # Normalize name by stripping attempt suffixes to find the base topic
        import re
        base_name = re.sub(r'\s*[\(\-]\s*attempt\s*\d+\s*\)?', '', base_name, flags=re.IGNORECASE).strip()

        try:
            existing_res = db.table("assessments").select("assessment_name")\
                .eq("candidate_id", assessment_data.candidateId)\
                .eq("batch_id", assessment_data.batchId)\
                .execute()
            
            existing_attempts = 0
            if existing_res.data:
                for row in existing_res.data:
                    name = row.get("assessment_name", "")
                    norm_name = re.sub(r'\s*[\(\-]\s*attempt\s*\d+\s*\)?', '', name, flags=re.IGNORECASE).strip()
                    if norm_name.lower() == base_name.lower():
                        existing_attempts += 1
            
            if existing_attempts >= 2:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Maximum 2 attempts allowed for this assessment topic."
                )
        except HTTPException:
            raise
        except Exception as e:
            print(f"[Warn] Error checking existing attempts: {e}")
    
    try:
        assessment = Assessment(
            batchId=assessment_data.batchId,
            candidateId=assessment_data.candidateId,
            assessmentName=assessment_data.assessmentName,
            totalScore=assessment_data.totalScore,
            obtainedScore=assessment_data.obtainedScore,
            timeTaken=assessment_data.timeTaken
        )
        
        result = db.table("assessments").insert(assessment.to_dict()).execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create assessment")
        
        ret_val = AssessmentResponse(**row_to_api(result.data[0]))
        
        # Sync score to matching report card
        from app.services.assessment_sync_service import AssessmentSyncService
        AssessmentSyncService.sync_assessment_to_report_card(
            db,
            assessment_data.batchId,
            assessment_data.candidateId,
            assessment_data.assessmentName,
            assessment_data.obtainedScore,
            assessment_data.totalScore
        )

        # Gamification: Award bits for assessment performance and speed
        try:
            total_score_val = assessment_data.totalScore
            obtained_score_val = assessment_data.obtainedScore
            time_taken_val = assessment_data.timeTaken
            assessment_name_val = assessment_data.assessmentName

            percentage = (obtained_score_val / total_score_val * 100) if total_score_val > 0 else 0
            is_coding = "coding" in assessment_name_val.lower()

            bits_to_award = 0
            reason = ""

            if is_coding and percentage == 100 and time_taken_val is not None and time_taken_val <= 300:
                bits_to_award = 8
                reason = f"Fast & Perfect Coding Challenge Submission: {assessment_name_val}"
            elif percentage == 100:
                bits_to_award = 6
                reason = f"Perfect score on assessment: {assessment_name_val}"
                if time_taken_val is not None and time_taken_val <= 180:
                    bits_to_award += 2
                    reason += " (Rapid Completion)"
            elif percentage >= 90:
                bits_to_award = 4
                reason = f"High performance on assessment: {assessment_name_val}"
                if time_taken_val is not None and time_taken_val <= 180:
                    bits_to_award += 2
                    reason += " (Rapid Completion)"
            elif time_taken_val is not None and time_taken_val <= 180:
                bits_to_award = 2
                reason = f"Rapid completion of assessment: {assessment_name_val}"

            if bits_to_award > 0:
                from app.services.gamification_service import GamificationService
                GamificationService.award_bits(
                    db,
                    candidate_id=assessment_data.candidateId,
                    amount=bits_to_award,
                    reason=reason
                )
        except Exception as gamification_err:
            print(f"[Warn] Gamification points award failed for assessment {assessment_data.assessmentName}: {gamification_err}")

        # Log ASSESSMENT_UPLOAD for any role
        try:
            role_label = current_user.get("role", "User").title()
            user_name = current_user.get("fullName", role_label)
            batch_res = db.table("batches").select("batch_name").eq("id", assessment_data.batchId).execute()
            batch_name = batch_res.data[0]["batch_name"] if batch_res.data else "Unknown"
            
            if current_user.get("role") == "TRAINEE":
                msg = f"Trainee {user_name} submitted assessment '{assessment_data.assessmentName}' for Batch '{batch_name}' (Score: {assessment_data.obtainedScore}/{assessment_data.totalScore})."
            else:
                msg = f"{role_label} {user_name} graded assessment '{assessment_data.assessmentName}' for Batch '{batch_name}'."
                
            db.table("notifications").insert({
                "type": "ASSESSMENT_UPLOAD",
                "message": msg,
                "is_read": False,
                "created_at": datetime.utcnow().isoformat()
            }).execute()
        except Exception as notif_err:
            print(f"[Warn] Failed to create ASSESSMENT_UPLOAD notification: {notif_err}")

        return ret_val
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/candidate/{candidate_id}", response_model=List[AssessmentResponse])
async def get_candidate_assessments(
    candidate_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get assessments for a candidate"""
    db = get_db()
    import asyncio
    await asyncio.to_thread(check_candidate_access, db, current_user, candidate_id)
    
    try:
        result = await asyncio.to_thread(db.table("assessments").select("*").eq("candidate_id", candidate_id).execute)
        return [AssessmentResponse(**row_to_api(a)) for a in result.data]
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/batch/{batch_id}", response_model=List[AssessmentResponse])
async def get_batch_assessments(
    batch_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get all assessments for a batch"""
    db = get_db()
    import asyncio
    await asyncio.to_thread(check_batch_access, db, current_user, batch_id)
    
    try:
        result = await asyncio.to_thread(db.table("assessments").select("*").eq("batch_id", batch_id).execute)
        return [AssessmentResponse(**row_to_api(a)) for a in result.data]
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{assessment_id}", response_model=AssessmentResponse)
async def update_assessment(
    assessment_id: str,
    assessment_data: AssessmentUpdate,
    current_user: dict = Depends(has_role("TRAINER", "COORDINATOR"))
):
    """Update assessment"""
    db = get_db()
    check_assessment_access(db, current_user, assessment_id)
    
    # Check if batch is CLOSED
    current_assessment_res = db.table("assessments").select("batch_id").eq("id", assessment_id).execute()
    if not current_assessment_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    batch_id = current_assessment_res.data[0].get("batch_id")
    if batch_id:
        batch_res = db.table("batches").select("*").eq("id", batch_id).execute()
        if batch_res.data:
            from app.routers.batch import sync_batch_status
            batch = sync_batch_status(db, batch_res.data[0])
            if batch.get("status") == "CLOSED":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot update assessment for a CLOSED batch."
                )
    
    try:
        raw = assessment_data.model_dump(exclude_unset=True)
        
        # Map camelCase to snake_case
        field_map = {
            "assessmentName": "assessment_name",
            "totalScore": "total_score",
            "obtainedScore": "obtained_score",
        }
        
        update_dict = {}
        for key, value in raw.items():
            db_key = field_map.get(key, key)
            update_dict[db_key] = value
        
        # Recalculate percentage and result if scores changed
        if "obtained_score" in update_dict or "total_score" in update_dict:
            current = db.table("assessments").select("*").eq("id", assessment_id).execute()
            
            if not current.data:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Assessment not found"
                )
            
            current_row = current.data[0]
            total = update_dict.get("total_score", current_row.get("total_score"))
            obtained = update_dict.get("obtained_score", current_row.get("obtained_score"))
            
            update_dict["percentage"] = (obtained / total * 100) if total > 0 else 0
            
            assessment_name = current_row.get("assessment_name", "")
            is_coding = "coding" in assessment_name.lower()
            threshold = 80.0 if is_coding else 40.0
            update_dict["result"] = "PASS" if update_dict["percentage"] >= threshold else "FAIL"
        
        result = db.table("assessments").update(update_dict).eq("id", assessment_id).execute()
        
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found"
            )
        
        ret_val = AssessmentResponse(**row_to_api(result.data[0]))
        
        # Sync updated score to matching report card
        row = result.data[0]
        from app.services.assessment_sync_service import AssessmentSyncService
        AssessmentSyncService.sync_assessment_to_report_card(
            db,
            row.get("batch_id"),
            row.get("candidate_id"),
            row.get("assessment_name"),
            row.get("obtained_score"),
            row.get("total_score")
        )

        # Log ASSESSMENT_UPLOAD if graded/updated by any role
        try:
            role_label = current_user.get("role", "User").title()
            user_name = current_user.get("fullName", role_label)
            updated_row = result.data[0]
            batch_id = updated_row.get("batch_id")
            assessment_name = updated_row.get("assessment_name", "Assessment")
            if batch_id:
                batch_res = db.table("batches").select("batch_name").eq("id", batch_id).execute()
                batch_name = batch_res.data[0]["batch_name"] if batch_res.data else "Unknown"
                
                if current_user.get("role") == "TRAINEE":
                    msg = f"Trainee {user_name} updated/submitted assessment '{assessment_name}' for Batch '{batch_name}'."
                else:
                    msg = f"{role_label} {user_name} graded/updated assessment '{assessment_name}' for Batch '{batch_name}'."
                
                db.table("notifications").insert({
                    "type": "ASSESSMENT_UPLOAD",
                    "message": msg,
                    "is_read": False,
                    "created_at": datetime.utcnow().isoformat()
                }).execute()
        except Exception as notif_err:
            print(f"[Warn] Failed to create ASSESSMENT_UPLOAD notification: {notif_err}")

        return ret_val
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/batch/{batch_id}/report", response_model=BatchReportResponse)
async def get_batch_report(
    batch_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get assessment report for batch"""
    db = get_db()
    import asyncio
    await asyncio.to_thread(check_batch_access, db, current_user, batch_id)
    
    try:
        # Run batches, assessments, and attendances queries in parallel using asyncio.gather
        batch_result, assessments_result, attendance_result = await asyncio.gather(
            asyncio.to_thread(db.table("batches").select("*").eq("id", batch_id).execute),
            asyncio.to_thread(db.table("assessments").select("*").eq("batch_id", batch_id).execute),
            asyncio.to_thread(db.table("attendances").select("id").eq("batch_id", batch_id).execute)
        )
        if not batch_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Batch not found"
            )
        
        batch = batch_result.data[0]
        assessments = assessments_result.data
        
        total_candidates = batch.get("candidates_count", 0)
        avg_score = 0
        passed_count = 0
        failed_count = 0
        
        if assessments:
            avg_score = sum([a.get("percentage", 0) for a in assessments]) / len(assessments)
            passed_count = sum(1 for a in assessments if a.get("result") == "PASS")
            failed_count = sum(1 for a in assessments if a.get("result") == "FAIL")
        
        return BatchReportResponse(
            batchId=batch_id,
            batchName=batch.get("batch_name"),
            totalCandidates=total_candidates,
            totalAttendance=len(attendance_result.data),
            averageScore=avg_score,
            assessmentsPassed=passed_count,
            assessmentsFailed=failed_count
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{batch_id}/generate-questions", response_model=BatchResponse)
async def generate_assessment_questions(
    batch_id: str,
    current_user: dict = Depends(has_role("ADMIN", "COORDINATOR", "TRAINER"))
):
    """Generate assessment questions for a batch using Gemini 2.5 Flash via Langchain"""
    from app.core.config import settings
    from langchain_google_genai import ChatGoogleGenerativeAI
    import json
    
    db = get_db()
    check_batch_access(db, current_user, batch_id)
    
    # 1. Fetch batch
    try:
        result = db.table("batches").select("*").eq("id", batch_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Batch not found")
        batch_row = result.data[0]
        
        from app.routers.batch import sync_batch_status
        batch_row = sync_batch_status(db, batch_row)
        if batch_row.get("status") == "CLOSED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot generate assessment questions for a CLOSED batch."
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=f"Database error: {str(e)}")
        
    api_batch = row_to_api(batch_row)
    topics = api_batch.get("topics", [])
    
    # 2. Check curriculum topics
    if not topics:
        raise HTTPException(
            status_code=400, 
            detail="This batch has no curriculum topics defined. Please configure the curriculum topics and subtopics first."
        )
        
    # 3. Check Azure AI Services API key
    if not settings.AZURE_OPENAI_API_KEY or settings.AZURE_OPENAI_API_KEY.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Azure AI Services API Key is not configured. Please add AZURE_OPENAI_API_KEY to your .env file."
        )
        
    # 4. Determine expected assessments based on category
    category_upper = str(api_batch.get("category", "SPARK")).upper()
    if "FOUNDATION" in category_upper:
        assessments_to_generate = ["GA1", "GA2", "GA3", "GA4", "GA5"]
    elif "STREAM" in category_upper:
        assessments_to_generate = [f"MCQ {i}" for i in range(1, 8)]
    else:  # SPARK phase 1 & 2
        assessments_to_generate = [
            "Communication Skills",
            "Interpersonal Skills",
            "Business Etiquette",
            "Service Orientation",
            "Emotional Intelligence & Empathy",
            "Accountability & Ownership",
            "Presentation Skills"
        ]
        
    formatted_curriculum = "\n".join([f"- {t}" for t in topics])
    formatted_assessments = ", ".join(assessments_to_generate)
    
    prompt = f"""You are a senior technical instructor and curriculum assessor. Your task is to generate assessment assessment questions for the course batch: {api_batch.get("batchName")}.
   
    You MUST generate exactly 3 challenging multiple-choice questions (MCQs) for each of the following required assessment names:
    {formatted_assessments}
    
    To ensure the questions are highly relevant, align them with the following course curriculum topics:
    {formatted_curriculum}
   
    Requirements:
    1. Generate exactly one MCQTopicGroup for each required assessment name.
    2. The 'topic' field in the output MUST exactly match the required assessment name (e.g. "GA1", "Assessment 1", "MCQ 1", etc.) character-for-character.
    3. Each question must have exactly 4 choices (options) and exactly 1 correctAnswer.
    4. The 'correctAnswer' field MUST match one of the string options in the 'options' list exactly.
    5. Keep questions, options, and correctness keys concise to minimize generated output tokens.
    """
    
    # 5. Call Azure OpenAI via Langchain
    try:
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(
            model=settings.AZURE_OPENAI_DEPLOYMENT,
            api_key=settings.AZURE_OPENAI_API_KEY,
            base_url=settings.AZURE_OPENAI_ENDPOINT,
            temperature=0.2
        )
        
        structured_llm = llm.with_structured_output(AssessmentQuestionsSchema)
        response = await structured_llm.ainvoke(prompt)
        
        # Format the structured output to match the database expected structure
        generated_questions = []
        for i, topic_group in enumerate(response.topics):
            # Enforce expected name matching by index or name
            expected_name = assessments_to_generate[i] if i < len(assessments_to_generate) else topic_group.topic
            matched_name = expected_name
            for name in assessments_to_generate:
                if name.lower().replace(" ", "") == topic_group.topic.lower().replace(" ", ""):
                    matched_name = name
                    break
                    
            group_dict = {
                "topic": matched_name,
                "questions": [
                    {
                        "question": q.question,
                        "options": q.options,
                        "correctAnswer": q.correctAnswer
                    }
                    for q in topic_group.questions
                ]
            }
            generated_questions.append(group_dict)
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")
        
    # 6. Update database record
    desc_str = batch_row.get("description")
    existing_desc_json = {}
    if desc_str:
        try:
            existing_desc_json = json.loads(desc_str)
            if not isinstance(existing_desc_json, dict):
                existing_desc_json = {"text": desc_str}
        except Exception:
            existing_desc_json = {"text": desc_str}
            
    existing_desc_json["questions"] = generated_questions
    
    update_data = {
        "description": json.dumps(existing_desc_json)
    }
    
    try:
        update_result = db.table("batches").update(update_data).eq("id", batch_id).execute()
        if not update_result.data:
            raise HTTPException(status_code=500, detail="Failed to update batch details in the database.")
            
        return BatchResponse(**row_to_api(update_result.data[0]))
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=f"Database update error: {str(e)}")

@router.get("/batch/{batch_id}/window", response_model=AssessmentWindowStatus)
async def get_assessment_window(
    batch_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get assessment window open/close status for a batch.

    The assessment window is the period between batch end_date and the
    category-specific deadline after which the batch transitions to CLOSED
    and all score writes are locked.

    Window durations by category:
    - SPARK      : 2 days
    - FOUNDATIONAL: 7 days
    - STREAM     : 14 days
    """
    from datetime import datetime as dt, timedelta, timezone
    from app.routers.batch import get_assessment_window_days, sync_batch_status
    import asyncio

    db = get_db()
    await asyncio.to_thread(check_batch_access, db, current_user, batch_id)

    batch_res = await asyncio.to_thread(db.table("batches").select("*").eq("id", batch_id).execute)
    if not batch_res.data:
        raise HTTPException(status_code=404, detail="Batch not found")

    batch_row = await asyncio.to_thread(sync_batch_status, db, batch_res.data[0])
    from app.models.models import row_to_api
    batch = row_to_api(batch_row)

    category = batch.get("category") or "SPARK"
    window_days = get_assessment_window_days(category)

    # Parse end_date
    end_date_raw = batch_row.get("end_date")
    if not end_date_raw:
        raise HTTPException(status_code=400, detail="Batch end date is not set.")

    try:
        if "T" in end_date_raw:
            end_dt = dt.fromisoformat(end_date_raw.replace("Z", "+00:00"))
        else:
            end_dt = dt.strptime(end_date_raw[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse batch end date.")

    window_opens_on = end_dt
    window_closes_on = end_dt + timedelta(days=window_days)
    now_utc = dt.now(timezone.utc)

    batch_status = batch_row.get("status", "PLANNED")
    window_open = batch_status == "COMPLETED"
    days_remaining = None
    if window_open:
        delta = (window_closes_on - now_utc).days
        days_remaining = max(delta, 0)

    return AssessmentWindowStatus(
        batchId=batch_id,
        batchName=batch_row.get("batch_name", ""),
        category=category,
        endDate=end_dt,
        windowOpen=window_open,
        windowDays=window_days,
        windowOpensOn=window_opens_on,
        windowClosesOn=window_closes_on,
        daysRemaining=days_remaining
    )


@router.get("/batch/{batch_id}/available", response_model=List[str])
async def get_available_assessment_names(
    batch_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get the list of valid assessment names for the batch based on its category"""
    db = get_db()
    import asyncio
    await asyncio.to_thread(check_batch_access, db, current_user, batch_id)
    
    # 1. Fetch batch
    batch_res = await asyncio.to_thread(db.table("batches").select("category", "phase").eq("id", batch_id).execute)
    if not batch_res.data:
        raise HTTPException(status_code=404, detail="Batch not found")
        
    batch = batch_res.data[0]
    category = batch.get("category", "SPARK")
    
    names = []
    if category == "SPARK":
        names = [
            "Communication Skills",
            "Interpersonal Skills",
            "Business Etiquette",
            "Service Orientation",
            "Emotional Intelligence & Empathy",
            "Accountability & Ownership",
            "Presentation Skills"
        ]
    elif category == "FOUNDATIONAL":
        for i in range(1, 6):
            names.append(f"GA{i} - Attempt 1")
            names.append(f"GA{i} - Attempt 2")
        names.extend([
            "Project Evaluation - Attempt 1", "Project Evaluation - Attempt 2",
            "Final Grade - Attempt 1", "Final Grade - Attempt 2"
        ])
    elif category == "STREAM":
        for i in range(1, 8):
            names.append(f"MCQ {i} - Attempt 1")
            names.append(f"MCQ {i} - Attempt 2")
        for i in range(1, 8):
            names.append(f"Coding {i} - Attempt 1")
            names.append(f"Coding {i} - Attempt 2")
        for i in range(1, 3):
            names.append(f"Project {i} - Attempt 1")
            names.append(f"Project {i} - Attempt 2")
        names.extend(["Online Coding - Attempt 1", "Online Coding - Attempt 2"])
        
    return names

# ============ Coding Assessment IDE Schemas & Routes ============

class CodingTestCase(BaseModel):
    input: str = Field(description="Sample input string for the test case")
    expectedOutput: str = Field(description="Expected output string for the test case")
    isHidden: bool = Field(description="Whether this is a hidden test case (for grading) or visible (sample test case)")

class CodingTopicGroup(BaseModel):
    topic: str = Field(description="The name of the coding assessment, which MUST exactly match one of the required coding assessment names e.g., 'Coding 1', 'Coding 2', ..., 'Coding 7', or 'Online Coding'.")
    problemStatement: str = Field(description="The clear description of the problem statement")
    inputFormat: str = Field(description="The input format description")
    outputFormat: str = Field(description="The output format description")
    constraints: str = Field(description="The constraints, e.g. N <= 10^5")
    sampleInput: str = Field(description="A sample input string")
    sampleOutput: str = Field(description="The corresponding sample output string")
    testCases: List[CodingTestCase] = Field(description="Exactly 4 test cases for validation, with at least 2 hidden (isHidden=True) and at least 2 visible (isHidden=False, matching sampleInput/sampleOutput)")

class CodingAssessmentQuestionsSchema(BaseModel):
    topics: List[CodingTopicGroup] = Field(description="List of coding assessment questions grouped by topic")

@router.post("/{batch_id}/generate-coding-questions", response_model=BatchResponse)
async def generate_coding_questions(
    batch_id: str,
    current_user: dict = Depends(has_role("ADMIN", "COORDINATOR", "TRAINER"))
):
    """Generate coding assessment questions for a batch using Gemini 2.5 Flash via Langchain"""
    from app.core.config import settings
    from langchain_google_genai import ChatGoogleGenerativeAI
    import json
    
    db = get_db()
    check_batch_access(db, current_user, batch_id)
    
    # 1. Fetch batch
    try:
        result = db.table("batches").select("*").eq("id", batch_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Batch not found")
        batch_row = result.data[0]
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=f"Database error: {str(e)}")
        
    api_batch = row_to_api(batch_row)
    topics = api_batch.get("topics", [])
    
    # 2. Check curriculum topics
    if not topics:
        raise HTTPException(
            status_code=400, 
            detail="This batch has no curriculum topics defined. Please configure curriculum topics first."
        )
        
    # 3. Check Azure AI Services API key
    if not settings.AZURE_OPENAI_API_KEY or settings.AZURE_OPENAI_API_KEY.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Azure AI Services API Key is not configured. Please add AZURE_OPENAI_API_KEY to your .env file."
        )
        
    category_upper = str(api_batch.get("category", "SPARK")).upper()
    if "STREAM" not in category_upper and "FOUNDATION" not in category_upper:
        raise HTTPException(
            status_code=400,
            detail="Coding questions can only be generated for STREAM or FOUNDATIONAL category batches."
        )
        
    coding_assessments = [f"Coding {i}" for i in range(1, 8)] + ["Online Coding"]
    
    formatted_curriculum = "\n".join([f"- {t}" for t in topics])
    formatted_assessments = ", ".join(coding_assessments)
    
    prompt = f"""You are a senior technical instructor and curriculum assessor. Your task is to generate assessment coding challenges for the course batch: {api_batch.get("batchName")}.
   
    You MUST generate exactly one coding question / challenge for each of the following required coding assessment names:
    {formatted_assessments}
    
    To ensure the coding questions are highly relevant, align them with the following course curriculum topics:
    {formatted_curriculum}
   
    Requirements:
    1. Generate exactly one CodingTopicGroup for each required coding assessment name.
    2. The 'topic' field in the output MUST exactly match the required coding assessment name (e.g. "Coding 1", "Coding 2", ..., "Coding 7", "Online Coding") character-for-character.
    3. The problem statement should be high-quality, professional, and clear.
    4. Provide clear input format, output format, constraints, sample input, and sample output.
    5. Each challenge must include exactly 4 test cases under the 'testCases' list.
    6. At least 2 test cases MUST be hidden (isHidden=True) which check edge cases or general cases for automatic grading.
    7. At least 2 test cases MUST be visible (isHidden=False) and one of them MUST match the sampleInput and sampleOutput exactly.
    8. Keep problem statements, constraints, and test case values highly concise and focused to minimize generated output tokens.
    """
    
    # 5. Call Azure OpenAI via Langchain
    try:
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(
            model=settings.AZURE_OPENAI_DEPLOYMENT,
            api_key=settings.AZURE_OPENAI_API_KEY,
            base_url=settings.AZURE_OPENAI_ENDPOINT,
            temperature=0.2
        )
        
        structured_llm = llm.with_structured_output(CodingAssessmentQuestionsSchema)
        response = await structured_llm.ainvoke(prompt)
        
        # Format the structured output to match the database expected structure
        generated_questions = []
        for i, topic_group in enumerate(response.topics):
            # Enforce expected name matching
            expected_name = coding_assessments[i] if i < len(coding_assessments) else topic_group.topic
            matched_name = expected_name
            for name in coding_assessments:
                if name.lower().replace(" ", "") == topic_group.topic.lower().replace(" ", ""):
                    matched_name = name
                    break
                    
            group_dict = {
                "topic": matched_name,
                "problemStatement": topic_group.problemStatement,
                "inputFormat": topic_group.inputFormat,
                "outputFormat": topic_group.outputFormat,
                "constraints": topic_group.constraints,
                "sampleInput": topic_group.sampleInput,
                "sampleOutput": topic_group.sampleOutput,
                "testCases": [
                    {
                        "input": tc.input,
                        "expectedOutput": tc.expectedOutput,
                        "isHidden": tc.isHidden
                    }
                    for tc in topic_group.testCases
                ]
            }
            generated_questions.append(group_dict)
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Coding Generation failed: {str(e)}")
        
    # 6. Update database record
    desc_str = batch_row.get("description")
    existing_desc_json = {}
    if desc_str:
        try:
            existing_desc_json = json.loads(desc_str)
            if not isinstance(existing_desc_json, dict):
                existing_desc_json = {"text": desc_str}
        except Exception:
            existing_desc_json = {"text": desc_str}
            
    existing_desc_json["coding_questions"] = generated_questions
    
    update_data = {
        "description": json.dumps(existing_desc_json)
    }
    
    try:
        update_result = db.table("batches").update(update_data).eq("id", batch_id).execute()
        if not update_result.data:
            raise HTTPException(status_code=500, detail="Failed to update batch details in the database.")
            
        return BatchResponse(**row_to_api(update_result.data[0]))
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=f"Database update error: {str(e)}")

class CodeExecutionRequest(BaseModel):
    source_code: str
    language_id: int
    stdin: Optional[str] = ""

import httpx

@router.post("/execute")
async def execute_code(
    payload: CodeExecutionRequest,
    current_user: dict = Depends(get_current_user)
):
    """Proxy code execution request to Judge0 CE API synchronously using base64 encoding/decoding"""
    import base64
    import asyncio
    from app.core.config import settings
    
    judge0_url = settings.JUDGE0_API_URL.rstrip('/')
    url = f"{judge0_url}/submissions?base64_encoded=true&wait=true"
    
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # Add RapidAPI headers if API key is present
    if settings.JUDGE0_API_KEY:
        headers["X-RapidAPI-Host"] = "judge0-ce.p.rapidapi.com"
        headers["X-RapidAPI-Key"] = settings.JUDGE0_API_KEY
        
    def b64_encode(s: str) -> str:
        if not s:
            return ""
        return base64.b64encode(s.encode('utf-8')).decode('utf-8')
        
    def b64_decode(s: str) -> str:
        if not s:
            return ""
        try:
            return base64.b64decode(s.encode('utf-8')).decode('utf-8')
        except Exception:
            return s
            
    encoded_source = b64_encode(payload.source_code)
    
    json_data = {
        "source_code": encoded_source,
        "language_id": payload.language_id
    }
    
    # Only include stdin if the user actually provided input
    # This avoids issues where empty base64 stdin causes unexpected behavior
    if payload.stdin and payload.stdin.strip():
        json_data["stdin"] = b64_encode(payload.stdin)
    else:
        json_data["stdin"] = ""
    
    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=json_data, headers=headers)
                
                # Handle rate limiting specifically
                if response.status_code == 429:
                    if attempt < max_retries:
                        await asyncio.sleep(1.0 * attempt)
                        continue
                    raise HTTPException(
                        status_code=429,
                        detail="Code execution service is rate-limited. Please wait a few seconds and try again."
                    )
                
                response.raise_for_status()
                res_data = response.json()
                
                # Base64 decode output fields if they are returned encoded
                if "stdout" in res_data and res_data["stdout"]:
                    res_data["stdout"] = b64_decode(res_data["stdout"])
                if "stderr" in res_data and res_data["stderr"]:
                    res_data["stderr"] = b64_decode(res_data["stderr"])
                if "compile_output" in res_data and res_data["compile_output"]:
                    res_data["compile_output"] = b64_decode(res_data["compile_output"])
                    
                return res_data
        except HTTPException:
            raise
        except httpx.HTTPStatusError as e:
            if attempt == max_retries:
                try:
                    err_detail = e.response.json()
                except Exception:
                    err_detail = e.response.text
                raise HTTPException(
                    status_code=e.response.status_code,
                    detail=f"Judge0 API returned error: {err_detail}"
                )
            await asyncio.sleep(0.5 * attempt)
        except Exception as e:
            if attempt == max_retries:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to communicate with Judge0 CE execution service: {str(e)}"
                )
            await asyncio.sleep(0.5 * attempt)

@router.get("/judge0-languages")
async def get_judge0_languages(
    current_user: dict = Depends(get_current_user)
):
    """Retrieve supported programming languages from Judge0 CE"""
    from app.core.config import settings
    
    judge0_url = settings.JUDGE0_API_URL.rstrip('/')
    url = f"{judge0_url}/languages"
    
    headers = {}
    if settings.JUDGE0_API_KEY:
        headers["X-RapidAPI-Host"] = "judge0-ce.p.rapidapi.com"
        headers["X-RapidAPI-Key"] = settings.JUDGE0_API_KEY
        
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        return [
            {"id": 71, "name": "Python (3.8.1)"},
            {"id": 63, "name": "JavaScript (Node.js 12.14.0)"},
            {"id": 62, "name": "Java (OpenJDK 13.0.1)"},
            {"id": 54, "name": "C++ (GCC 9.2.0)"},
            {"id": 82, "name": "SQL (SQLite 3.31.1)"},
            {"id": 74, "name": "TypeScript (3.7.4)"}
        ]
