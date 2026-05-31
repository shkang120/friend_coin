import os
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pydantic import BaseModel
from typing import List, Dict, Any
import copy

# .env 파일에서 비밀번호 읽어오기
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGO_URL = os.getenv("MONGO_URL")
IMGBB_API_KEY = os.getenv("IMGBB_API_KEY")

client = MongoClient(MONGO_URL)
db = client["friend_coin_db"]

default_friends = [
    { "id": 1, "name": "서민수", "emoji": "🍔", "price": 20000, "basePrice": 20000, "maxPrice": 20000, "status": "active", "badges": [], "history": [{"price": 20000, "time": "05.29 11:39"}] },
    { "id": 2, "name": "김태윤", "emoji": "🎮", "price": 20000, "basePrice": 20000, "maxPrice": 20000, "status": "active", "badges": [], "history": [{"price": 20000, "time": "05.29 11:39"}] },
    { "id": 3, "name": "임서준", "emoji": "📚", "price": 20000, "basePrice": 20000, "maxPrice": 20000, "status": "active", "badges": [], "history": [{"price": 20000, "time": "05.29 11:39"}] },
    { "id": 4, "name": "박지우", "emoji": "⚽", "price": 20000, "basePrice": 20000, "maxPrice": 20000, "status": "active", "badges": [], "history": [{"price": 20000, "time": "05.29 11:39"}] }
]

default_profile = { 
    "name": "Guest", "profileImage": "", "emoji": "👨‍💻", "price": 20000, "basePrice": 20000, "maxPrice": 20000, "status": "active",
    "goodTickets": 2, "badTickets": 2, "lastRefillTime": None, "lastDailyAttendance": None, "weeklyTicketsClaimed": False,
    "lastDailyAdBonus": None, "dailyAdTicketsDate": None, "dailyAdTicketsCount": 0, 
    "badges": [], "stats": { "goodGiven": 0, "badGiven": 0, "trialCount": 0 },
    "isVIP": False, "nameColor": "#333d4b" 
}

class GameData(BaseModel):
    friends: List[Dict[str, Any]]
    agendas: List[Dict[str, Any]]
    profile: Dict[str, Any]
    noti: List[Dict[str, Any]]

@app.get("/")
def read_root():
    return {"message": "서버가 정상 작동 중입니다 🚀"}

# ★ 신규 추가: 닉네임 중복 검사 창구
@app.get("/api/check-nickname")
def check_nickname(nickname: str):
    # DB의 users 컬렉션에서 해당 닉네임을 쓰는 사람이 있는지 검색
    existing_user = db["users"].find_one({"profile.name": nickname})
    if existing_user:
        return {"available": False, "message": "이미 사용 중인 닉네임입니다."}
    return {"available": True, "message": "사용 가능한 닉네임입니다!"}

# ★ 변경됨: 이름표(username) 대신 이메일(email)로 서랍장 찾기!
@app.get("/api/data/{email}")
def get_user_data(email: str):
    global_data = db["global_state"].find_one({"_id": "global"})
    if not global_data:
        global_data = {"friends": default_friends, "agendas": []}
        db["global_state"].insert_one({"_id": "global", **global_data})

    user_data = db["users"].find_one({"_id": email})
    
    # ★ 핵심 로직: 유저가 DB에 없으면 그냥 빈 데이터를 만들지 않고, 
    # "이 사람 처음 온 신규 유저야!" 라고 프론트엔드에 알려줌 (isNewUser: True)
    if not user_data:
        return {
            "isNewUser": True,
            "friends": global_data.get("friends", []),
            "agendas": global_data.get("agendas", [])
        }

    return {
        "isNewUser": False,
        "friends": global_data.get("friends", []),
        "agendas": global_data.get("agendas", []),
        "profile": user_data.get("profile", {}),
        "noti": user_data.get("noti", [])
    }

# ★ 변경됨: 데이터 저장할 때도 이메일(email)을 서랍장 이름표로 사용
@app.post("/api/save/{email}")
def save_user_data(email: str, data: GameData):
    db["global_state"].update_one(
        {"_id": "global"},
        {"$set": {"friends": data.friends, "agendas": data.agendas}},
        upsert=True
    )
    db["users"].update_one(
        {"_id": email},
        {"$set": {"profile": data.profile, "noti": data.noti}},
        upsert=True
    )
    return {"status": "success"}

@app.post("/api/upload")
def upload_image(image: UploadFile = File(...)):
    try:
        file_bytes = image.file.read()
        url = f"https://api.imgbb.com/1/upload?key={IMGBB_API_KEY}"
        files = {"image": (image.filename, file_bytes, image.content_type)}
        response = requests.post(url, files=files)
        data = response.json()
        
        if data.get("success"):
            return {"url": data["data"]["url"]}
        else:
            return {"error": "Upload failed"}
    except Exception as e:
        return {"error": str(e)}