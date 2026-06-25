from pydantic import BaseModel, EmailStr


# ==========================================
# USER REGISTER
# ==========================================

class UserRegisterSchema(BaseModel):

    username: str
    email: EmailStr
    password: str


# ==========================================
# USER LOGIN
# ==========================================

class UserLoginSchema(BaseModel):

    email: EmailStr
    password: str