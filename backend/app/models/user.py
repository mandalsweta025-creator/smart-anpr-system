from sqlalchemy import Column, Integer, String
from backend.app.database.connection import Base


class User(Base):

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="operator")
    token_version = Column(Integer, default=0, nullable=False, server_default="0")