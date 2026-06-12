from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
import os
import httpx
from dotenv import load_dotenv
from datetime import datetime, timedelta # ★ 시간 처리를 위해 추가된 도구

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGO_URL = os.getenv("MONGO_URL")
client = MongoClient(MONGO_URL)
db = client["friend_coin_db"] 

class EvalData(BaseModel):
    evaluator_email: str
    target_email: str
    eval_type: str
    intensity: int
    reason: str = ""

class UserData(BaseModel):
    profile: dict
    noti: list

class RoomData(BaseModel):
    email: str
    room_name: str = ""
    room_code: str = ""

class ChatData(BaseModel):
    room_code: str
    sender_email: str
    sender_name: str
    message: str

class AgendaData(BaseModel):
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

@app.get("/api/data/{email:path}")
@app.get("/api/data/{email}")
def get_user_data(email: str):
    search_email = email.strip().lower()
    user_data = db["users"].find_one({"_id": search_email})
    
    if not user_data: 
        return {
            "isNewUser": True,
            "profile": {},
            "noti": [],
            "my_rooms": [],
            "global_ranking": []
        }

    my_rooms_cursor = db["rooms"].find({"members": search_email})
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
            "messages": room.get("messages", []) 
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

@app.post("/api/save/{email:path}")
def save_user_data(email: str, data: UserData):
    search_email = email.strip().lower()
    db["users"].update_one(
        {"_id": search_email}, 
        {"$set": {"profile": data.profile, "noti": data.noti}}, 
        upsert=True
    )
    return {"status": "success"}

@app.post("/api/evaluate")
def evaluate_user(data: EvalData):
    evaluator = db["users"].find_one({"_id": data.evaluator_email})
    target = db["users"].find_one({"_id": data.target_email})
    if not evaluator or not target: return {"status": "error", "message": "유저를 찾을 수 없습니다."}

    if data.eval_type == 'good':
        if evaluator["profile"].get("goodTickets", 0) <= 0: return {"status": "error", "message": "호평권 부족"}
        evaluator["profile"]["goodTickets"] -= 1
        evaluator["profile"]["stats"]["goodGiven"] = evaluator["profile"]["stats"].get("goodGiven", 0) + 1
    else:
        if evaluator["profile"].get("badTickets", 0) <= 0: return {"status": "error", "message": "악평권 부족"}
        evaluator["profile"]["badTickets"] -= 1
        evaluator["profile"]["stats"]["badGiven"] = evaluator["profile"]["stats"].get("badGiven", 0) + 1

    db["users"].update_one({"_id": data.evaluator_email}, {"$set": {"profile": evaluator["profile"]}})

    base_price = target["profile"].get("basePrice", 20000)
    change_rate = data.intensity * 0.01
    change_amount = base_price * change_rate
    
    if data.eval_type == 'good':
        target["profile"]["price"] += change_amount
    else:
        target["profile"]["price"] -= change_amount

    # ★ 차트 기록용 배열 (시간 포함) 업데이트
    if "priceHistory" not in target["profile"] or not target["profile"]["priceHistory"]:
        target["profile"]["priceHistory"] = [target["profile"].get("basePrice", 20000)]
        target["profile"]["timeHistory"] = ["시작"]

    target["profile"]["priceHistory"].append(target["profile"]["price"])

    # ★ 한국 시간(UTC+9)으로 현재 시간 계산해서 시간 기록 배열에 추가
    kst_now = datetime.utcnow() + timedelta(hours=9)
    current_time_str = kst_now.strftime("%m.%d %H:%M")
    
    if "timeHistory" not in target["profile"]:
        target["profile"]["timeHistory"] = [""] * (len(target["profile"]["priceHistory"]) - 1)
    target["profile"]["timeHistory"].append(current_time_str)

    eval_icon = "👍호평" if data.eval_type == "good" else "👎악평"
    evaluator_name = evaluator.get("profile", {}).get("name", "익명")
    noti_msg = f"[{eval_icon}] {evaluator_name}님의 평가: {data.reason}"
    
    if "noti" not in target:
        target["noti"] = []
    
    target["noti"].insert(0, noti_msg)
    target["noti"] = target["noti"][:30] 

    db["users"].update_one({"_id": data.target_email}, {"$set": {"profile": target["profile"], "noti": target["noti"]}})
    
    return {"status": "success"}

@app.get("/api/check-nickname")
def check_nickname(nickname: str):
    user = db["users"].find_one({"profile.name": nickname})
    if user: return {"available": False, "message": "이미 사용 중인 닉네임입니다."}
    return {"available": True}

@app.post("/api/room/create")
def create_room(data: RoomData):
    import random, string
    code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    db["rooms"].insert_one({
        "_id": code, "name": data.room_name, "members": [data.email.strip().lower()],
        "agendas": [], "messages": []
    })
    return {"status": "success", "room_code": code}

@app.post("/api/room/join")
def join_room(data: RoomData):
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room: return {"status": "error", "message": "존재하지 않는 코드입니다."}
    user_email = data.email.strip().lower()
    if user_email not in room.get("members", []):
        db["rooms"].update_one({"_id": data.room_code}, {"$push": {"members": user_email}})
    return {"status": "success"}

@app.post("/api/room/leave")
def leave_room(data: RoomData):
    user_email = data.email.strip().lower()
    db["rooms"].update_one({"_id": data.room_code}, {"$pull": {"members": user_email}})
    return {"status": "success"}

@app.post("/api/room/chat")
def send_chat(data: ChatData):
    chat_msg = {
        "sender_email": data.sender_email.strip().lower(),
        "sender_name": data.sender_name,
        "message": data.message
    }
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"messages": chat_msg}})
    return {"status": "success"}

@app.post("/api/agenda/create")
def create_agenda(data: AgendaData):
    import uuid
    agenda_id = str(uuid.uuid4())
    target = db["users"].find_one({"_id": data.target_email})
    target_name = target.get("profile", {}).get("name", "알 수 없음") if target else "알 수 없음"
    
    agenda = {
        "id": agenda_id, "creator_email": data.creator_email, "target_email": data.target_email,
        "target_name": target_name, "type": data.agenda_type, "reason": data.reason,
        "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active"
    }
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"agendas": agenda}})
    return {"status": "success", "message": "주주총회 안건이 상정되었습니다!"}

@app.post("/api/agenda/vote")
def vote_agenda(data: VoteData):
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room: return {"status": "error", "message": "방이 없습니다."}
    
    agendas = room.get("agendas", [])
    target_agenda = None
    for a in agendas:
        if a["id"] == data.agenda_id:
            target_agenda = a
            break
            
    if not target_agenda: return {"status": "error", "message": "안건을 찾을 수 없습니다."}
    if data.voter_email in target_agenda.get("votedUsers", []): return {"status": "error", "message": "이미 투표하셨습니다."}
    
    target_agenda["votedUsers"].append(data.voter_email)
    if data.vote_type == "agree": target_agenda["agreeVotes"] += 1
    else: target_agenda["disagreeVotes"] += 1
    
    total_members = len(room.get("members", []))
    required_votes = (total_members // 2) + 1
    
    status_msg = "success"
    message = "투표 완료"
    
    if target_agenda["agreeVotes"] >= required_votes:
        target_agenda["status"] = "resolved"
        target_user = db["users"].find_one({"_id": target_agenda["target_email"]})
        
        if target_user:
            if target_agenda["type"] == "delist":
                target_user["profile"]["status"] = "delisted"
                target_user["profile"]["price"] = 0
                message = f"🚨 {target_agenda['target_name']}님이 상장폐지 처리되었습니다."
            elif target_agenda["type"] == "revival":
                target_user["profile"]["status"] = "active"
                target_user["profile"]["price"] = 10000
                message = f"🌱 {target_agenda['target_name']}님이 기적적으로 회생(재상장) 되었습니다!"
                
            db["users"].update_one({"_id": target_agenda["target_email"]}, {"$set": {"profile": target_user["profile"]}})
        
        status_msg = "resolved"
        
    elif target_agenda["disagreeVotes"] >= required_votes:
        target_agenda["status"] = "rejected"
        status_msg = "resolved"
        message = f"⚖️ 반대표가 많아 안건이 기각되었습니다."

    db["rooms"].update_one({"_id": data.room_code}, {"$set": {"agendas": agendas}})
    return {"status": status_msg, "message": message}

@app.post("/api/upload")
async def upload_image(image: UploadFile = File(...)):
    import base64
    contents = await image.read()
    img_b64 = base64.b64encode(contents).decode("utf-8")
    api_key = os.getenv("IMGBB_API_KEY")
    
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"https://api.imgbb.com/1/upload?key={api_key}",
            data={"image": img_b64}
        )
    data = res.json()
    if data.get("success"):
        return {"url": data["data"]["url"]}
    return {"error": "업로드 실패"}