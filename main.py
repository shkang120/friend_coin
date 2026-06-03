import os
import random
import string
import requests
import base64
import time
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

class ProfileData(BaseModel):
    profile: Dict[str, Any]
    noti: List[Any]

class RoomCreate(BaseModel):
    email: str
    room_name: str

class RoomJoin(BaseModel):
    email: str
    room_code: str

# ★ 방 나가기 데이터 구조
class RoomLeave(BaseModel):
    email: str
    room_code: str

# ★ 채팅 데이터 구조
class ChatData(BaseModel):
    room_code: str
    sender_email: str
    sender_name: str
    message: str

class EvalData(BaseModel):
    evaluator_email: str
    target_email: str
    eval_type: str 
    intensity: int 

class AgendaCreateData(BaseModel):
    room_code: str
    creator_email: str
    target_email: str
    agenda_type: str
    reason: str

class VoteData(BaseModel):
    room_code: str
    agenda_id: str
    voter_email: str
    vote_type: str 

def generate_room_code():
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if not db["rooms"].find_one({"_id": code}):
            return code

@app.get("/")
def read_root():
    return {"message": "친구 코인 서버 정상 작동 중 🚀"}

@app.get("/api/check-nickname")
def check_nickname(nickname: str):
    existing = db["users"].find_one({"profile.name": nickname})
    if existing: return {"available": False, "message": "이미 사용 중인 닉네임입니다."}
    return {"available": True, "message": "사용 가능한 닉네임입니다!"}

@app.get("/api/data/{email}")
def get_user_data(email: str):
    user_data = db["users"].find_one({"_id": email})
    if not user_data: return {"isNewUser": True}

    my_rooms_cursor = db["rooms"].find({"members": email})
    my_rooms = []
    
    for room in my_rooms_cursor:
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
            "agendas": room.get("agendas", []),
            "messages": room.get("messages", []) # ★ 채팅 내용 불러오기
        })

    all_users = list(db["users"].find({}, {"profile": 1}))
    sorted_users = sorted(all_users, key=lambda x: x.get("profile", {}).get("price", 0), reverse=True)[:10]
    global_ranking = [u.get("profile") for u in sorted_users if "profile" in u]

    return {
        "isNewUser": False,
        "profile": user_data.get("profile", {}),
        "noti": user_data.get("noti", []),
        "my_rooms": my_rooms,          
        "global_ranking": global_ranking 
    }

@app.post("/api/save/{email}")
def save_user_data(email: str, data: ProfileData):
    if data.profile and data.profile.get("name"):
        db["users"].update_one({"_id": email}, {"$set": {"profile": data.profile, "noti": data.noti}}, upsert=True)
    return {"status": "success"}

@app.post("/api/evaluate")
def evaluate_user(data: EvalData):
    evaluator = db["users"].find_one({"_id": data.evaluator_email})
    target = db["users"].find_one({"_id": data.target_email})
    if not evaluator or not target: return {"status": "error", "message": "유저 정보를 찾을 수 없습니다."}

    e_prof = evaluator.get("profile", {})
    t_prof = target.get("profile", {})
    t_noti = target.get("noti", [])
    e_name = e_prof.get("name", "누군가")

    current_price = t_prof.get("price", 20000)
    intensity_pct = data.intensity if data.intensity in [1, 2, 3] else 1
    delta_price = int(current_price * (intensity_pct / 100.0))

    if data.eval_type == "good":
        if e_prof.get("goodTickets", 0) <= 0: return {"status": "error", "message": "남은 호평권이 없습니다!"}
        e_prof["goodTickets"] -= 1
        e_prof.setdefault("stats", {})["goodGiven"] = e_prof["stats"].get("goodGiven", 0) + 1
        t_prof["price"] = current_price + delta_price
        if t_prof["price"] > t_prof.get("maxPrice", 20000): t_prof["maxPrice"] = t_prof["price"]
        t_noti.append(f"👍 {e_name}님이 {intensity_pct}% 호평을 남겨 주가가 {delta_price}p 상승했습니다!")

    elif data.eval_type == "bad":
        if e_prof.get("badTickets", 0) <= 0: return {"status": "error", "message": "남은 악평권이 없습니다!"}
        e_prof["badTickets"] -= 1
        e_prof.setdefault("stats", {})["badGiven"] = e_prof["stats"].get("badGiven", 0) + 1
        t_prof["price"] = current_price - delta_price
        t_noti.append(f"👎 {e_name}님이 {intensity_pct}% 악평을 남겨 주가가 {delta_price}p 하락했습니다!")

    db["users"].update_one({"_id": data.evaluator_email}, {"$set": {"profile": e_prof}})
    db["users"].update_one({"_id": data.target_email}, {"$set": {"profile": t_prof, "noti": t_noti}})
    return {"status": "success", "message": "평가가 성공적으로 반영되었습니다!"}

@app.post("/api/agenda/create")
def create_agenda(data: AgendaCreateData):
    room = db["rooms"].find_one({"_id": data.room_code})
    target_user = db["users"].find_one({"_id": data.target_email})
    if not room or not target_user: return {"status": "error", "message": "정보를 찾을 수 없습니다."}
    
    agendas = room.get("agendas", [])
    for a in agendas:
        if a["target_email"] == data.target_email and a["status"] == "active":
            return {"status": "error", "message": "이미 이 유저에 대한 재판이 진행 중입니다."}

    agenda_id = str(random.randint(100000, 999999))
    new_agenda = {
        "id": agenda_id, "type": data.agenda_type, "target_email": data.target_email,
        "target_name": target_user["profile"]["name"], "reason": data.reason,
        "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active"
    }
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"agendas": new_agenda}})
    return {"status": "success", "message": "재판이 상정되었습니다!"}

@app.post("/api/agenda/vote")
def vote_agenda(data: VoteData):
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room: return {"status": "error", "message": "방을 찾을 수 없습니다."}
    agendas = room.get("agendas", [])
    target_agenda = None
    agenda_idx = -1
    for i, a in enumerate(agendas):
        if a["id"] == data.agenda_id and a["status"] == "active":
            target_agenda = a
            agenda_idx = i
            break
    if not target_agenda: return {"status": "error", "message": "종료되었거나 존재하지 않는 안건입니다."}
    if data.voter_email in target_agenda["votedUsers"]: return {"status": "error", "message": "이미 투표하셨습니다!"}

    db["rooms"].update_one(
        {"_id": data.room_code, "agendas.id": data.agenda_id},
        {"$inc": {"agendas.$.agreeVotes" if data.vote_type == "agree" else "agendas.$.disagreeVotes": 1},
         "$push": {"agendas.$.votedUsers": data.voter_email}}
    )

    updated_room = db["rooms"].find_one({"_id": data.room_code})
    agenda = updated_room["agendas"][agenda_idx]
    total_members = len(updated_room["members"])
    required_votes = (total_members // 2) + 1
    
    if agenda["agreeVotes"] >= required_votes:
        t_user = db["users"].find_one({"_id": agenda["target_email"]})
        t_prof = t_user["profile"]
        t_noti = t_user.get("noti", [])
        if agenda["type"] == "delist":
            t_prof["status"] = "delisted"
            t_noti.append(f"🚨 주주총회 결과, 코인이 [상장폐지] 되었습니다.")
        elif agenda["type"] == "revival":
            t_prof["status"] = "active"
            t_prof["price"] = 20000 
            t_noti.append(f"🌱 코인이 [재상장] 되었습니다!")
        db["users"].update_one({"_id": agenda["target_email"]}, {"$set": {"profile": t_prof, "noti": t_noti}})
        db["rooms"].update_one({"_id": data.room_code, "agendas.id": data.agenda_id}, {"$set": {"agendas.$.status": "passed"}})
        return {"status": "resolved", "result": "passed", "message": "과반수 찬성으로 최종 가결되었습니다!"}
    elif agenda["disagreeVotes"] >= required_votes or (agenda["agreeVotes"] + agenda["disagreeVotes"] == total_members):
        if agenda["disagreeVotes"] >= agenda["agreeVotes"]:
            db["rooms"].update_one({"_id": data.room_code, "agendas.id": data.agenda_id}, {"$set": {"agendas.$.status": "rejected"}})
            return {"status": "resolved", "result": "rejected", "message": "최종 기각(부결)되었습니다."}
    return {"status": "success", "message": "투표가 기록되었습니다."}

@app.post("/api/room/create")
def create_room(data: RoomCreate):
    code = generate_room_code()
    new_room = {"_id": code, "name": data.room_name, "members": [data.email], "agendas": [], "messages": []}
    db["rooms"].insert_one(new_room)
    return {"status": "success", "room_code": code, "room_name": data.room_name}

@app.post("/api/room/join")
def join_room(data: RoomJoin):
    room = db["rooms"].find_one({"_id": data.room_code.upper()})
    if not room: return {"status": "error", "message": "존재하지 않는 초대 코드입니다."}
    if data.email in room["members"]: return {"status": "error", "message": "이미 참여 중입니다."}
    db["rooms"].update_one({"_id": data.room_code.upper()}, {"$push": {"members": data.email}})
    return {"status": "success", "room_name": room["name"]}

# ★ 신규 추가: 클럽(방) 나가기 API
@app.post("/api/room/leave")
def leave_room(data: RoomLeave):
    db["rooms"].update_one({"_id": data.room_code}, {"$pull": {"members": data.email}})
    return {"status": "success"}

# ★ 신규 추가: 채팅 보내기 API
@app.post("/api/room/chat")
def send_chat(data: ChatData):
    chat_msg = {
        "sender_email": data.sender_email,
        "sender_name": data.sender_name,
        "message": data.message,
        "timestamp": int(time.time())
    }
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"messages": chat_msg}})
    return {"status": "success"}

@app.get("/api/reset/{email}")
def reset_user(email: str):
    db["users"].delete_one({"_id": email})
    db["rooms"].update_many({"members": email}, {"$pull": {"members": email}})
    return {"message": "계정 삭제 완료"}

@app.post("/api/upload")
def upload_image(image: UploadFile = File(...)):
    try:
        if not IMGBB_API_KEY: return {"error": "API key missing"}
        file_bytes = image.file.read()
        encoded_image = base64.b64encode(file_bytes).decode("utf-8")
        url = "https://api.imgbb.com/1/upload"
        payload = {"key": IMGBB_API_KEY, "image": encoded_image}
        response = requests.post(url, data=payload)
        data = response.json()
        if data.get("success"): return {"url": data["data"]["url"]}
        return {"error": "Upload failed"}
    except Exception as e: return {"error": str(e)}