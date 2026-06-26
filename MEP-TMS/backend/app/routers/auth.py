from fastapi import APIRouter, HTTPException, status, Depends
from datetime import timedelta, datetime
from app.schemas.schemas import LoginRequest, LoginResponse, TokenValidate, UserResponse, TraineeLoginRequest
from app.core.security import hash_password, verify_password, create_access_token, decode_token, get_current_user
from app.core.database import get_db
from app.models.models import User, UserRole, row_to_api
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/api/auth", tags=["auth"])


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    newPassword: str

@router.post("/register", response_model=UserResponse)
async def register(user_data: dict):
    """Register a new user (Disabled)"""
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Public registration is disabled. All accounts must be created by an Administrator."
    )

@router.post("/login", response_model=LoginResponse)
async def login(credentials: LoginRequest):
    """Login user"""
    db = get_db()
    
    email = credentials.email.strip().lower()
    
    # Find user by email
    result = db.table("users").select("*").eq("email", email).execute()
    
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    user = result.data[0]
    
    if not verify_password(credentials.password, user.get("password_hash")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Create access token
    access_token = create_access_token(
        data={
            "sub": user["id"],
            "email": user.get("email"),
            "role": user.get("role"),
            "fullName": user.get("full_name", "")
        }
    )
    
    # Update last login and reset is_first_login time in DB
    try:
        from datetime import datetime as datetime_cls
        now_str = datetime_cls.utcnow().isoformat()
        update_payload = {"last_login": now_str}
        if user.get("is_first_login"):
            update_payload["is_first_login"] = False
        db.table("users").update(update_payload).eq("id", user["id"]).execute()
        user["last_login"] = now_str
    except Exception as e:
        print(f"Failed to update last login: {e}")

    user_api = row_to_api(user)
    user_response = UserResponse(**user_api)
    
    # Log login event
    try:
        from app.models.models import Notification
        login_log = Notification(
            type="LOGIN_LOG",
            message=f"User {user.get('email')} logged in.",
            recipientId=user["id"]
        )
        db.table("notifications").insert(login_log.to_dict()).execute()
    except Exception as e:
        print(f"Failed to log login: {e}")
        
    return LoginResponse(
        accessToken=access_token,
        user=user_response,
        expiresIn=3600  # 1 hour
    )

@router.get("/validate", response_model=TokenValidate)
async def validate_token(current_user: dict = Depends(get_current_user)):
    """Validate JWT token"""
    db = get_db()
    
    # Fetch current user data
    result = db.table("users").select("*").eq("id", current_user.get("sub")).execute()
    
    if not result.data:
        return TokenValidate(isValid=False)
    
    user_api = row_to_api(result.data[0])
    user_response = UserResponse(**user_api)
    return TokenValidate(isValid=True, user=user_response)

@router.post("/trainee-login", response_model=LoginResponse)
async def trainee_login(credentials: TraineeLoginRequest):
    """Login Trainee using Email or Employee ID (MAV-XXX)"""
    db = get_db()
    
    username = credentials.username.strip()
    email = None
    
    if "@" in username:
        email = username.lower()
    else:
        # Look up candidate by registration_number (Employee ID)
        cand_res = db.table("candidates").select("email").eq("registration_number", username).execute()
        if cand_res.data:
            email = cand_res.data[0]["email"]
        else:
            # Look up trainee_pool by registration_number (Employee ID)
            pool_res = db.table("trainee_pool").select("email").eq("registration_number", username).execute()
            if pool_res.data:
                email = pool_res.data[0]["email"]
            else:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid Employee ID or password"
                )
            
    # Find user by email
    result = db.table("users").select("*").eq("email", email).execute()
    
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Credentials"
        )
        
    user = result.data[0]
    
    if not verify_password(credentials.password, user.get("password_hash")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
        
    if user.get("role") != "TRAINEE":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only trainees are allowed to log in here."
        )
        
    access_token = create_access_token(
        data={
            "sub": user["id"],
            "email": user.get("email"),
            "role": user.get("role"),
            "fullName": user.get("full_name", "")
        }
    )
    
    # Update last login and reset is_first_login time in DB
    try:
        from datetime import datetime as datetime_cls
        now_str = datetime_cls.utcnow().isoformat()
        update_payload = {"last_login": now_str}
        if user.get("is_first_login"):
            update_payload["is_first_login"] = False
        db.table("users").update(update_payload).eq("id", user["id"]).execute()
        user["last_login"] = now_str
    except Exception as e:
        print(f"Failed to update last login: {e}")

    user_api = row_to_api(user)
    user_response = UserResponse(**user_api)
    
    # Log login event
    try:
        from app.models.models import Notification
        login_log = Notification(
            type="LOGIN_LOG",
            message=f"Trainee {user.get('email')} logged in.",
            recipientId=user["id"]
        )
        db.table("notifications").insert(login_log.to_dict()).execute()
    except Exception as e:
        print(f"Failed to log login: {e}")
        
    return LoginResponse(
        accessToken=access_token,
        user=user_response,
        expiresIn=3600
    )

@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    """Logout user (token invalidation handled by client)"""
    db = get_db()
    try:
        from datetime import datetime as datetime_cls
        db.table("users").update({"last_logout": datetime_cls.utcnow().isoformat()}).eq("id", current_user["sub"]).execute()
        
        from app.models.models import Notification
        logout_log = Notification(
            type="LOGOUT_LOG",
            message=f"User {current_user.get('email')} logged out.",
            recipientId=current_user["sub"]
        )
        db.table("notifications").insert(logout_log.to_dict()).execute()
    except Exception as e:
        print(f"Failed to log logout: {e}")
    return {"message": "Logged out successfully"}



@router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    """
    Request a password reset link.
    Always returns 200 to avoid leaking whether an email exists.
    """
    db = get_db()
    from app.services.email_service import EmailService
    from app.core.config import settings

    email = request.email.strip().lower()
    print(f"\n--- PASSWORD RESET REQUEST ---")
    print(f"Target Email: {email}")

    result = db.table("users").select("id, email, full_name, role").eq("email", email).execute()

    if result.data:
        user = result.data[0]
        print(f"User Found: {user['full_name']} (Role: {user['role']})")

        # Create a short-lived reset token (1 hour), scoped with purpose="password_reset"
        reset_token = create_access_token(
            data={
                "sub": user["id"],
                "email": user["email"],
                "purpose": "password_reset",
            },
            expires_delta=timedelta(hours=1),
        )

        # Build the reset URL — points to the frontend reset page
        frontend_base = "http://localhost:5173"
        reset_url = f"{frontend_base}/reset-password?token={reset_token}"
        
        print(f"🔑 [RESET LINK GENERATED]: {reset_url}")

        subject = "MEP-TMS — Password Reset Request"
        body = f"""Dear {user.get('full_name', 'User')},

We received a request to reset the password for your MEP-TMS account ({user['email']}).

Click the link below to set a new password. This link is valid for 1 hour.

👉 Reset Password: {reset_url}

If you did not request a password reset, you can safely ignore this email — your password will remain unchanged.

Best Regards,
MEP-TMS Security Team
"""
        print(f"Sending email via EmailService...")
        sent = await EmailService.send_email(user["email"], subject, body)
        print(f"📧 [EMAIL SENT STATUS]: {sent}")
    else:
        print(f"❌ [USER NOT FOUND]: Email {email} is not registered in the database.")
    print(f"-------------------------------\n")

    response_payload = {"message": "If that email is registered, a password reset link has been sent."}
    if settings.DEBUG and result.data:
        response_payload["debugLink"] = reset_url

    # Always return 200 regardless of whether the email was found
    return response_payload


@router.post("/reset-password")
async def reset_password(request: ResetPasswordRequest):
    """
    Consume a password reset token and update the user's password.
    """
    db = get_db()

    if len(request.newPassword) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long.",
        )

    # Decode and validate the token
    payload = decode_token(request.token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link is invalid or has expired. Please request a new one.",
        )

    if payload.get("purpose") != "password_reset":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid reset token.",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid reset token.")

    # Verify user still exists
    result = db.table("users").select("id, email").eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found.")

    # Hash and save the new password
    new_hash = hash_password(request.newPassword)
    db.table("users").update({"password_hash": new_hash}).eq("id", user_id).execute()

    # Log the password reset event
    try:
        db.table("notifications").insert({
            "type": "SETTING_CHANGE",
            "message": f"Password was reset for user {result.data[0]['email']} via reset link.",
            "recipient_id": user_id,
            "is_read": False,
            "created_at": datetime.utcnow().isoformat(),
        }).execute()
    except Exception:
        pass

    return {"message": "Password updated successfully. You can now log in with your new password."}


@router.get("/test-email")
async def test_email(email: str = "vasudevguptha@gmail.com"):
    """
    Temporary endpoint to trigger a test email to verify SMTP settings.
    """
    from app.services.email_service import EmailService
    subject = "MEP-TMS SMTP Test via GET Route"
    body = f"Hello,\n\nThis is a test email triggered via the GET /api/auth/test-email endpoint to {email}.\n\nBest Regards,\nMEP-TMS Team"
    
    print(f"\n--- API TEST EMAIL TRIGGERED ---")
    print(f"To: {email}")
    sent = await EmailService.send_email(email, subject, body)
    print(f"Result: {sent}")
    print(f"--------------------------------\n")
    
    if sent:
        return {"status": "success", "message": f"Test email successfully sent to {email}."}
    else:
        return {"status": "error", "message": f"Failed to send email to {email}."}
