from fastapi import FastAPI, UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
import os
import httpx
import uuid
import secrets
import string
from dotenv import load_dotenv
from datetime import datetime, timedelta

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False, # 토큰 자격 증명 충돌 방지용 필수 설정
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

# 🛡️ 보안 패치: 프론트엔드에서 날짜를 조작하지 못하도록 입력값 제외
class RewardData(BaseModel):
    email: str
    reward_type: str

class RespondEvalData(BaseModel):
    email: str
    eval_id: str
    action: str

def verify_google_token(auth_header: str):
    if not auth_header or not auth_header.startswith("Bearer "): return None
    token = auth_header.split(" ")[1]
    try:
        response = httpx.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={token}")
        if response.status_code != 200: return None
        data = response.json()
        if data.get("aud") != "837250448431-hrlfbnof2bf4acofs03e28t3qdpkun5g.apps.googleusercontent.com": return None
        return data.get("email").strip().lower()
    except Exception: return None

@app.get("/api/data")
def get_user_data(authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email: return {"status": "unauthenticated", "message": "인증 실패"}

    user_data = db["users"].find_one({"_id": email})
    if not user_data:
        return {"isNewUser": True, "profile": {}, "noti": [], "my_rooms": [], "global_ranking": []}

    profile = user_data.get("profile", {})

    if profile.get("narackStartTime") and profile.get("narackLastHitEmail"):
        start_time = datetime.fromisoformat(profile["narackStartTime"])
        if datetime.utcnow() >= start_time + timedelta(days=30):
            last_hit_email = profile["narackLastHitEmail"]
            common_room = db["rooms"].find_one({"members": {"$all": [email, last_hit_email]}})
            if common_room:
                agenda_id = str(uuid.uuid4())
                agenda = {
                    "id": agenda_id, "creator_email": "system", "target_email": email,
                    "target_name": profile.get("name", "알 수 없음"), "type": "delist",
                    "reason": f"📉 [시스템 자동 상정] 최고 주가 대비 -70% 이하의 나락 상태에서 30일 동안 탈출하지 못했습니다. (마지막 타격자: {last_hit_email})",
                    "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active"
                }
                db["rooms"].update_one({"_id": common_room["_id"]}, {"$push": {"agendas": agenda}})

                profile["narackStartTime"] = None
                profile["narackLastHitEmail"] = None
                db["users"].update_one({"_id": email}, {"$set": {"profile": profile}})

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
        my_rooms.append({"room_code": room["_id"], "room_name": room["name"], "members": members_profiles, "agendas": room.get("agendas", []), "messages": room.get("messages", [])})

    all_users = list(db["users"].find({}, {"profile": 1}))
    sorted_users = sorted(all_users, key=lambda x: x.get("profile", {}).get("price", 0), reverse=True)[:10]
    global_ranking = [u.get("profile") for u in sorted_users if "profile" in u]

    return {"isNewUser": False, "profile": profile, "noti": user_data.get("noti", []), "my_rooms": my_rooms, "global_ranking": global_ranking}

@app.post("/api/save")
def save_user_data(data: UserData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email: return {"status": "error", "message": "인증 실패"}
    existing_user = db["users"].find_one({"_id": email})
    if existing_user and "profile" in existing_user:
        db_profile = existing_user["profile"]
        db_profile["name"] = data.profile.get("name", db_profile.get("name"))
        db_profile["profileImage"] = data.profile.get("profileImage", db_profile.get("profileImage"))
        db_profile["nameColor"] = data.profile.get("nameColor", db_profile.get("nameColor"))
        db_profile["isVIP"] = data.profile.get("isVIP", db_profile.get("isVIP"))
        final_profile = db_profile
    else: final_profile = data.profile
    db["users"].update_one({"_id": email}, {"$set": {"profile": final_profile, "noti": data.noti}}, upsert=True)
    return {"status": "success"}

@app.post("/api/reward")
def claim_reward(data: RewardData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    user = db["users"].find_one({"_id": email})
    if not user: return {"status": "error", "message": "유저 없음"}

    profile = user["profile"]
    kst_now = datetime.utcnow() + timedelta(hours=9)
    # 🛡️ 백엔드가 클라이언트를 믿지 않고 스스로 한국 날짜를 도장 찍어 검증
    server_today_str = kst_now.strftime("%Y-%m-%d")
    time_str = kst_now.strftime("%m.%d %H:%M")
    msg = ""

    if data.reward_type == 'attendance':
        if profile.get("lastDailyAttendance") == server_today_str: return {"status": "error", "message": "이미 완료하셨습니다!"}
        profile["price"] = profile.get("price", 20000) + 50
        profile["lastDailyAttendance"] = server_today_str
        msg = "💵 일일 출석 완료!"
    elif data.reward_type == 'double_attendance':
        if profile.get("lastDailyAdBonus") == server_today_str: return {"status": "error", "message": "이미 완료하셨습니다!"}
        profile["price"] = profile.get("price", 20000) + 50
        profile["lastDailyAdBonus"] = server_today_str
        msg = "🎁 50p가 추가 상승했습니다."
    elif data.reward_type == 'extra_ticket':
        if profile.get("dailyAdTicketsDate") != server_today_str: profile["dailyAdTicketsCount"] = 0
        if profile.get("dailyAdTicketsCount", 0) >= 1: return {"status": "error", "message": "오늘은 더 받을 수 없습니다."}
        profile["goodTickets"] = profile.get("goodTickets", 0) + 1
        profile["badTickets"] = profile.get("badTickets", 0) + 1
        profile["dailyAdTicketsCount"] = profile.get("dailyAdTicketsCount", 0) + 1
        profile["dailyAdTicketsDate"] = server_today_str
        msg = "🎁 평가권 각 +1장 획득!"
    elif data.reward_type == 'weekly':
        if profile.get("weeklyTicketsClaimed"): return {"status": "error", "message": "이미 완료하셨습니다!"}
        profile["goodTickets"] = profile.get("goodTickets", 0) + 1
        profile["badTickets"] = profile.get("badTickets", 0) + 1
        profile["weeklyTicketsClaimed"] = True
        msg = "🎫 주간 보너스 평가권 획득!"

    if profile["price"] > profile.get("maxPrice", 20000): profile["maxPrice"] = profile["price"]

    if data.reward_type in ['attendance', 'double_attendance']:
        if "priceHistory" not in profile:
            profile["priceHistory"] = [profile.get("basePrice", 20000)]; profile["timeHistory"] = ["시작"]
        profile["priceHistory"].append(profile["price"])
        if "timeHistory" not in profile: profile["timeHistory"] = [""] * (len(profile["priceHistory"]) - 1)
        profile["timeHistory"].append(time_str)

    db["users"].update_one({"_id": email}, {"$set": {"profile": profile}})
    return {"status": "success", "message": msg, "profile": profile}

@app.post("/api/evaluate")
def evaluate_user(data: EvalData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.evaluator_email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    if data.evaluator_email == data.target_email: return {"status": "error", "message": "자신을 평가할 수 없습니다."}

    # 🛡️ 변동폭 제한 공격 완벽 방어
    if data.intensity not in [1, 2, 3]:
        return {"status": "error", "message": "올바르지 않은 변동 수치입니다."}

    evaluator = db["users"].find_one({"_id": data.evaluator_email})
    target = db["users"].find_one({"_id": data.target_email})
    if not evaluator or not target: return {"status": "error", "message": "유저 정보 없음"}

    evaluator_name = evaluator.get("profile", {}).get("name", "익명")

    if data.eval_type == 'good':
        if evaluator["profile"].get("goodTickets", 0) <= 0: return {"status": "error", "message": "호평권 부족"}
        evaluator["profile"]["goodTickets"] -= 1
        evaluator["profile"]["stats"]["goodGiven"] = evaluator["profile"]["stats"].get("goodGiven", 0) + 1
        db["users"].update_one({"_id": data.evaluator_email}, {"$set": {"profile": evaluator["profile"]}})

        base_price = target["profile"].get("basePrice", 20000)
        change_amount = base_price * (data.intensity * 0.01)
        target["profile"]["price"] += change_amount
        if target["profile"]["price"] > target["profile"].get("maxPrice", 20000):
            target["profile"]["maxPrice"] = target["profile"]["price"]

        if "priceHistory" not in target["profile"]:
            target["profile"]["priceHistory"] = [target["profile"].get("basePrice", 20000)]; target["profile"]["timeHistory"] = ["시작"]
        target["profile"]["priceHistory"].append(target["profile"]["price"])
        kst_now = datetime.utcnow() + timedelta(hours=9)
        target["profile"]["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))

        if "noti" not in target: target["noti"] = []
        target["noti"].insert(0, f"[👍호평] {evaluator_name}님의 평가 (+{data.intensity}%): {data.reason}")

        if target["profile"].get("narackStartTime") and target["profile"]["price"] > (target["profile"].get("maxPrice", 20000) * 0.3):
            target["profile"]["narackStartTime"] = None
            target["profile"]["narackLastHitEmail"] = None

        db["users"].update_one({"_id": data.target_email}, {"$set": {"profile": target["profile"], "noti": target["noti"]}})
        return {"status": "success", "message": "👍 호평이 즉시 반영되었습니다."}

    else:
        if evaluator["profile"].get("badTickets", 0) <= 0: return {"status": "error", "message": "악평권 부족"}
        evaluator["profile"]["badTickets"] -= 1
        evaluator["profile"]["stats"]["badGiven"] = evaluator["profile"]["stats"].get("badGiven", 0) + 1
        db["users"].update_one({"_id": data.evaluator_email}, {"$set": {"profile": evaluator["profile"]}})

        if "pending_evals" not in target["profile"]: target["profile"]["pending_evals"] = []

        pending_id = str(uuid.uuid4())
        pending_item = {
            "id": pending_id, "evaluator_email": data.evaluator_email, "evaluator_name": evaluator_name,
            "intensity": data.intensity, "reason": data.reason, "timestamp": datetime.utcnow().isoformat()
        }
        target["profile"]["pending_evals"].append(pending_item)
        db["users"].update_one({"_id": data.target_email}, {"$set": {"profile": target["profile"]}})
        return {"status": "success", "message": "👎 악평 전송 완료! 피평가자의 승인/이의제기를 대기합니다."}

@app.post("/api/evaluate/respond")
def respond_pending_evaluation(data: RespondEvalData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}

    user = db["users"].find_one({"_id": email})
    if not user: return {"status": "error", "message": "유저 없음"}

    profile = user["profile"]
    pending_list = profile.get("pending_evals", [])
    target_eval = next((e for e in pending_list if e["id"] == data.eval_id), None)
    if not target_eval: return {"status": "error", "message": "해당 악평 안건을 찾을 수 없습니다."}

    if data.action == "approve":
        base_price = profile.get("basePrice", 20000)
        change_amount = base_price * (target_eval["intensity"] * 0.01)
        profile["price"] = profile.get("price", 20000) - change_amount

        if "priceHistory" not in profile:
            profile["priceHistory"] = [base_price]; profile["timeHistory"] = ["시작"]
        profile["priceHistory"].append(profile["price"])
        kst_now = datetime.utcnow() + timedelta(hours=9)
        profile["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))

        if "noti" not in user: user["noti"] = []
        user["noti"].insert(0, f"[👎악평 수락] {target_eval['evaluator_name']}님의 악평(-{target_eval['intensity']}% 적용): {target_eval['reason']}")

        max_p = profile.get("maxPrice", 20000)
        if profile["price"] <= (max_p * 0.3) and not profile.get("narackStartTime"):
            profile["narackStartTime"] = datetime.utcnow().isoformat()
            profile["narackLastHitEmail"] = target_eval["evaluator_email"]

        profile["pending_evals"] = [e for e in pending_list if e["id"] != data.eval_id]
        db["users"].update_one({"_id": email}, {"$set": {"profile": profile, "noti": user["noti"]}})
        return {"status": "success", "message": "악평을 승인하여 주가 변동이 최종 반영되었습니다."}

    elif data.action == "defend":
        cur_month = datetime.utcnow().strftime("%Y-%m")
        if profile.get("defense_month") != cur_month:
            profile["defense_month"] = cur_month
            profile["defense_count"] = 0

        if profile.get("defense_count", 0) >= 3:
            return {"status": "error", "message": "이번 달 방어 재판권(3회)을 전부 소급 사용하셨습니다. 기각 불가."}

        common_room = db["rooms"].find_one({"members": {"$all": [email, target_eval["evaluator_email"]]}})
        if not common_room:
            return {"status": "error", "message": "공격한 유저와 같은 투자 클럽(방)에 소속되어 있지 않아 방어 재판을 개최할 수 없습니다."}

        profile["defense_count"] += 1

        agenda_id = str(uuid.uuid4())
        agenda = {
            "id": agenda_id, "creator_email": email, "target_email": email, "target_name": profile.get("name"),
            "type": "defense",
            "reason": f"⚖️ [악평 이의제기 방어 재판] 피고인이 {target_eval['evaluator_name']}님의 악평(-{target_eval['intensity']}%)에 정식 탄핵 요청을 제기했습니다.\n[악평 사유]: {target_eval['reason']}",
            "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active",
            "associated_eval": target_eval
        }

        profile["pending_evals"] = [e for e in pending_list if e["id"] != data.eval_id]
        db["rooms"].update_one({"_id": common_room["_id"]}, {"$push": {"agendas": agenda}})
        db["users"].update_one({"_id": email}, {"$set": {"profile": profile}})
        return {"status": "success", "message": f"⚖️ 성공적으로 법정에 탄핵 상정했습니다! (이번 달 남은 방어 기회: {3 - profile['defense_count']}회)"}

@app.get("/api/check-nickname")
def check_nickname(nickname: str):
    user = db["users"].find_one({"profile.name": nickname})
    if user: return {"available": False, "message": "이미 사용 중인 닉네임입니다."}
    return {"available": True}

@app.post("/api/room/create")
def create_room(data: RoomData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    # 🛡️ 암호학적으로 안전한 방 코드 난수 생성
    alphabet = string.ascii_uppercase + string.digits
    code = ''.join(secrets.choice(alphabet) for _ in range(6))
    db["rooms"].insert_one({"_id": code, "name": data.room_name, "members": [email], "agendas": [], "messages": []})
    return {"status": "success", "room_code": code}

@app.post("/api/room/join")
def join_room(data: RoomData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room: return {"status": "error", "message": "존재하지 않는 코드입니다."}
    if email not in room.get("members", []): db["rooms"].update_one({"_id": data.room_code}, {"$push": {"members": email}})
    return {"status": "success"}

@app.post("/api/room/leave")
def leave_room(data: RoomData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    db["rooms"].update_one({"_id": data.room_code}, {"$pull": {"members": email}})
    return {"status": "success"}

@app.post("/api/room/chat")
def send_chat(data: ChatData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.sender_email.strip().lower(): return {"status": "error", "message": "인증 실패"}

    # 🛡️ 방 가입 인원 여부 대조
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []):
        return {"status": "error", "message": "해당 클럽의 멤버가 아닙니다."}

    chat_msg = {"sender_email": email, "sender_name": data.sender_name, "message": data.message}
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"messages": chat_msg}})
    return {"status": "success"}

@app.post("/api/agenda/create")
def create_agenda(data: AgendaData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.creator_email.strip().lower(): return {"status": "error", "message": "인증 실패"}

    # 🛡️ 방 가입 인원 여부 대조
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []):
        return {"status": "error", "message": "해당 클럽의 멤버가 아닙니다."}

    agenda_id = str(uuid.uuid4())
    target = db["users"].find_one({"_id": data.target_email})
    target_name = target.get("profile", {}).get("name", "알 수 없음") if target else "알 수 없음"
    agenda = {"id": agenda_id, "creator_email": email, "target_email": data.target_email, "target_name": target_name, "type": data.agenda_type, "reason": data.reason, "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active"}
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"agendas": agenda}})
    return {"status": "success", "message": "주주총회 안건이 상정되었습니다!"}

@app.post("/api/agenda/vote")
def vote_agenda(data: VoteData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.voter_email.strip().lower(): return {"status": "error", "message": "인증 실패"}

    # 🛡️ 방 가입 인원 여부 대조
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []):
        return {"status": "error", "message": "방이 없거나 해당 클럽의 멤버가 아닙니다."}

    agendas = room.get("agendas", [])
    target_agenda = None
    for a in agendas:
        if a["id"] == data.agenda_id: target_agenda = a; break
    if not target_agenda: return {"status": "error", "message": "안건을 찾을 수 없습니다."}
    if email in target_agenda.get("votedUsers", []): return {"status": "error", "message": "이미 투표하셨습니다."}

    target_agenda["votedUsers"].append(email)
    if data.vote_type == "agree": target_agenda["agreeVotes"] += 1
    else: target_agenda["disagreeVotes"] += 1

    total_members = len(room.get("members", []))
    required_votes = (total_members // 2) + 1
    status_msg = "success"; message = "투표 완료"

    if target_agenda["agreeVotes"] >= required_votes:
        target_agenda["status"] = "resolved"
        target_user = db["users"].find_one({"_id": target_agenda["target_email"]})
        if target_user:
            if target_agenda["type"] == "delist":
                target_user["profile"]["status"] = "delisted"; target_user["profile"]["price"] = 0
                message = f"🚨 {target_agenda['target_name']}님이 자동/수동 판결에 의해 최종 상장폐지되었습니다."
            elif target_agenda["type"] == "revival":
                target_user["profile"]["status"] = "active"; target_user["profile"]["price"] = 10000
                message = f"🌱 {target_agenda['target_name']}님이 기적적으로 회생(재상장) 되었습니다!"
            elif target_agenda["type"] == "defense":
                assoc = target_agenda["associated_eval"]
                base_p = target_user["profile"].get("basePrice", 20000)
                change_amount = base_p * (assoc["intensity"] * 0.01)
                target_user["profile"]["price"] = target_user["profile"].get("price", 20000) - change_amount

                if "priceHistory" not in target_user["profile"]:
                    target_user["profile"]["priceHistory"] = [base_p]; target_user["profile"]["timeHistory"] = ["시작"]
                target_user["profile"]["priceHistory"].append(target_user["profile"]["price"])
                kst_now = datetime.utcnow() + timedelta(hours=9)
                target_user["profile"]["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))

                if "noti" not in target_user: target_user["noti"] = []
                target_user["noti"].insert(0, f"[👎재판 패소] 악평 정당화 판결 확정 (-{assoc['intensity']}% 적용): {assoc['reason']}")

                max_p = target_user["profile"].get("maxPrice", 20000)
                if target_user["profile"]["price"] <= (max_p * 0.3) and not target_user["profile"].get("narackStartTime"):
                    target_user["profile"]["narackStartTime"] = datetime.utcnow().isoformat()
                    target_user["profile"]["narackLastHitEmail"] = assoc["evaluator_email"]

                message = f"⚖️ [재판 판결] 배심원단이 악평을 정당하다고 판결했습니다! {target_agenda['target_name']}님의 주가가 하락합니다."

            db["users"].update_one({"_id": target_agenda["target_email"]}, {"$set": {"profile": target_user["profile"], "noti": target_user.get("noti", [])}})
        status_msg = "resolved"

    elif target_agenda["disagreeVotes"] >= required_votes:
        target_agenda["status"] = "rejected"; status_msg = "resolved"
        if target_agenda["type"] == "defense":
            message = f"⚖️ [재판 승리] 배심원단이 반대하여 {target_agenda['target_name']}님이 방어에 성공했습니다! 악평은 무효 소멸됩니다."
        else:
            message = f"⚖️ 반대표가 많아 안건이 최종 기각되었습니다."

    db["rooms"].update_one({"_id": data.room_code}, {"$set": {"agendas": agendas}})
    return {"status": status_msg, "message": message}

@app.post("/api/upload")
async def upload_image(image: UploadFile = File(...)):
    import base64
    contents = await image.read()
    img_b64 = base64.b64encode(contents).decode("utf-8")
    api_key = os.getenv("IMGBB_API_KEY")
    async with httpx.AsyncClient() as client: res = await client.post(f"https://api.imgbb.com/1/upload?key={api_key}", data={"image": img_b64})
    data = res.json()
    if data.get("success"): return {"url": data["data"]["url"]}
    return {"error": "업로드 실패"}