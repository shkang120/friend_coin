import os
import random
import string
import requests
import base64
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pydantic import BaseModel
from typing import List, Dict, Any

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

# 프론트엔드에서 받을 데이터 형식 정의
class ProfileData(BaseModel):
    profile: Dict[str, Any]
    noti: List[Any]

class RoomCreate(BaseModel):
    email: str
    room_name: str

class RoomJoin(BaseModel):
    email: str
    room_code: str

def generate_room_code():
    """6자리 영문+숫자 랜덤 초대 코드 생성"""
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if not db["rooms"].find_one({"_id": code}):
            return code

@app.get("/")
def read_root():
    return {"message": "친구 코인 서버 정상 작동 중 🚀 (Room 시스템 도입)"}

@app.get("/api/check-nickname")
def check_nickname(nickname: str):
    existing = db["users"].find_one({"profile.name": nickname})
    if existing:
        return {"available": False, "message": "이미 사용 중인 닉네임입니다."}
    return {"available": True, "message": "사용 가능한 닉네임입니다!"}

@app.get("/api/data/{email}")
def get_user_data(email: str):
    user_data = db["users"].find_one({"_id": email})

    if not user_data:
        return {"isNewUser": True}

    # 1. 내가 속한 방(Room) 목록 가져오기
    my_rooms_cursor = db["rooms"].find({"members": email})
    my_rooms = []
    
    for room in my_rooms_cursor:
        # 방에 속한 멤버들의 '글로벌 프로필(최신 주가 포함)'을 싹 다 가져옴
        members_profiles = []
        for member_email in room["members"]:
            m_data = db["users"].find_one({"_id": member_email})
            if m_data and "profile" in m_data:
                prof = m_data["profile"]
                prof["email"] = member_email
                members_profiles.append(prof)
                
        my_rooms.append({
            "room_code": room["_id"],
            "room_name": room["name"],
            "members": members_profiles,
            "agendas": room.get("agendas", []) # 이 방에서 열린 재판들
        })

    # 2. 글로벌 랭킹 Top 10 가져오기 (전국구 유저 대상)
    all_users = list(db["users"].find({}, {"profile": 1}))
    # 주가(price) 기준으로 내림차순 정렬 후 상위 10명 자르기
    sorted_users = sorted(all_users, key=lambda x: x.get("profile", {}).get("price", 0), reverse=True)[:10]
    global_ranking = [u.get("profile") for u in sorted_users if "profile" in u]

    return {
        "isNewUser": False,
        "profile": user_data.get("profile", {}),
        "noti": user_data.get("noti", []),
        "my_rooms": my_rooms,          # 내가 속한 단톡방 리스트 (친구들 최신 주가 포함)
        "global_ranking": global_ranking # 전국구 통합 랭킹
    }

# 내 개인 정보(주가, 닉네임 등) 저장
@app.post("/api/save/{email}")
def save_user_data(email: str, data: ProfileData):
    if data.profile and data.profile.get("name"):
        db["users"].update_one(
            {"_id": email},
            {"$set": {
                "profile": data.profile,
                "noti": data.noti
            }},
            upsert=True
        )
    return {"status": "success"}

# 방 만들기 API
@app.post("/api/room/create")
def create_room(data: RoomCreate):
    code = generate_room_code()
    new_room = {
        "_id": code,
        "name": data.room_name,
        "members": [data.email], # 만든 사람을 방에 첫 번째로 추가
        "agendas": []
    }
    db["rooms"].insert_one(new_room)
    return {"status": "success", "room_code": code, "room_name": data.room_name}

# 방 입장하기(초대 코드) API
@app.post("/api/room/join")
def join_room(data: RoomJoin):
    room = db["rooms"].find_one({"_id": data.room_code.upper()})
    if not room:
        return {"status": "error", "message": "존재하지 않는 초대 코드입니다."}
    
    if data.email in room["members"]:
        return {"status": "error", "message": "이미 이 방에 참여 중입니다."}
    
    db["rooms"].update_one(
        {"_id": data.room_code.upper()},
        {"$push": {"members": data.email}}
    )
    return {"status": "success", "room_name": room["name"]}

# 언제든 초기화할 수 있는 리셋 버튼 (테스트용)
@app.get("/api/reset/{email}")
def reset_user(email: str):
    db["users"].delete_one({"_id": email})
    # 내가 속해있던 방에서도 나를 빼주는 로직
    db["rooms"].update_many({"members": email}, {"$pull": {"members": email}})
    return {"message": "계정 삭제 완료"}

@app.post("/api/upload")
def upload_image(image: UploadFile = File(...)):
    try:
        if not IMGBB_API_KEY:
            print("🚨 에러: IMGBB_API_KEY가 없습니다. .env 파일을 확인하세요.")
            return {"error": "API key missing"}

        # 이미지를 읽어서 Base64(텍스트) 형태로 변환 (ImgBB가 가장 좋아하는 포맷!)
        file_bytes = image.file.read()
        encoded_image = base64.b64encode(file_bytes).decode("utf-8")

        url = "https://api.imgbb.com/1/upload"
        payload = {
            "key": IMGBB_API_KEY,
            "image": encoded_image
        }

        response = requests.post(url, data=payload)
        data = response.json()

        if data.get("success"):
            return {"url": data["data"]["url"]}
        else:
            # 실패 시 터미널에 진짜 이유를 출력!
            print("🚨 ImgBB 서버 거절 사유:", data)
            return {"error": "Upload failed"}

    except Exception as e:
        print("🚨 파이썬 서버 내부 에러:", str(e))
        return {"error": str(e)}