from fastapi import FastAPI, UploadFile, File, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pymongo import MongoClient
import os
import httpx
import uuid
import secrets
import string
import random
from dotenv import load_dotenv
from datetime import datetime, timedelta

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
client = MongoClient(MONGO_URL)
db = client["friend_coin_db"] 

class EvalData(BaseModel):
    evaluator_email: str
    target_email: str
    eval_type: str
    intensity: int
    reason: str = Field("", max_length=500)

class UserData(BaseModel):
    profile: dict
    noti: list

class RoomData(BaseModel):
    email: str
    room_name: str = Field("", max_length=30)
    room_code: str = ""

class ChatData(BaseModel):
    room_code: str
    sender_email: str
    sender_name: str
    message: str = Field(..., max_length=1000)

class AgendaData(BaseModel):
    room_code: str
    creator_email: str
    target_email: str
    agenda_type: str
    reason: str = Field(..., max_length=1000) 

class VoteData(BaseModel):
    room_code: str
    agenda_id: str
    voter_email: str
    vote_type: str

class RewardData(BaseModel):
    email: str
    reward_type: str

class RespondEvalData(BaseModel):
    email: str
    eval_id: str
    action: str

class EventAddData(BaseModel):
    room_code: str
    start_date: str
    end_date: str
    title: str = Field(..., max_length=50) 
    creator_name: str
    creator_email: str

class EventDeleteData(BaseModel):
    room_code: str
    event_id: str
    deleter_email: str

class ShopData(BaseModel):
    email: str
    item_type: str
    extra_data: str = ""

class GambleData(BaseModel):
    room_code: str
    email: str
    guess: str

api_cooldowns = { "chat": {}, "evaluate": {}, "agenda": {}, "join": {}, "gamble": {} }

def is_spamming(email: str, action_type: str, cooldown_seconds: int) -> bool:
    now = datetime.utcnow()
    last_time = api_cooldowns[action_type].get(email)
    if last_time and (now - last_time).total_seconds() < cooldown_seconds: return True 
    api_cooldowns[action_type][email] = now
    return False

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
    if not user_data: return {"isNewUser": True, "profile": {}, "noti": [], "my_rooms": [], "global_ranking": []}

    profile = user_data.get("profile", {})
    profile_modified = False

    kst_now = datetime.utcnow() + timedelta(hours=9)
    days_since_monday = kst_now.weekday()
    if kst_now.weekday() == 0 and kst_now.hour < 8: days_since_monday = 7
    recent_monday = (kst_now - timedelta(days=days_since_monday)).strftime("%Y-%m-%d")
    
    if profile.get("lastRefillMonday") != recent_monday:
        profile["goodTickets"] = 2; profile["badTickets"] = 2
        profile["weeklyTicketsClaimed"] = False; profile["lastRefillMonday"] = recent_monday
        profile_modified = True
    
    pending_list = profile.get("pending_evals", [])
    new_pending = []
    
    for e in pending_list:
        if "timestamp" in e:
            created = datetime.fromisoformat(e["timestamp"])
            if datetime.utcnow() >= created + timedelta(hours=24):
                base_p = profile.get("basePrice", 20000)
                change_amount = base_p * (e["intensity"] * 0.01)
                profile["price"] = profile.get("price", 20000) - change_amount
                
                if "priceHistory" not in profile: profile["priceHistory"] = [base_p]; profile["timeHistory"] = ["시작"]
                profile["priceHistory"].append(profile["price"])
                profile["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
                
                if "noti" not in user_data: user_data["noti"] = []
                user_data["noti"].insert(0, f"[👎자동 수락] 24시간 무응답으로 {e['evaluator_name']}님의 악평 강제 승인 (-{e['intensity']}% 적용)")
                
                max_p = profile.get("maxPrice", 20000)
                if profile["price"] <= (max_p * 0.3) and not profile.get("narackStartTime"):
                    profile["narackStartTime"] = datetime.utcnow().isoformat()
                    profile["narackLastHitEmail"] = e["evaluator_email"]
                    
                profile_modified = True
                continue
        new_pending.append(e)
        
    if profile_modified:
        profile["pending_evals"] = new_pending
        db["users"].update_one({"_id": email}, {"$set": {"profile": profile, "noti": user_data.get("noti", [])}})

    if profile.get("narackStartTime") and profile.get("narackLastHitEmail"):
        start_time = datetime.fromisoformat(profile["narackStartTime"])
        if datetime.utcnow() >= start_time + timedelta(days=30):
            last_hit_email = profile["narackLastHitEmail"]
            common_room = db["rooms"].find_one({"members": {"$all": [email, last_hit_email]}})
            if common_room:
                agenda = {
                    "id": str(uuid.uuid4()), "creator_email": "system", "target_email": email,
                    "target_name": profile.get("name", "알 수 없음"), "type": "delist",
                    "reason": f"📉 [시스템 자동 상정] 최고 주가 대비 -70% 이하의 나락 상태에서 30일 동안 탈출하지 못했습니다. (마지막 타격자: {last_hit_email})",
                    "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active",
                    "created_at": datetime.utcnow().isoformat()
                }
                db["rooms"].update_one({"_id": common_room["_id"]}, {"$push": {"agendas": agenda}})
                profile["narackStartTime"] = None; profile["narackLastHitEmail"] = None
                db["users"].update_one({"_id": email}, {"$set": {"profile": profile}})

    my_rooms_cursor = db["rooms"].find({"members": email})
    my_rooms = []
    for room in my_rooms_cursor:
        room_modified = False
        for a in room.get("agendas", []):
            if a.get("status") == "active" and a.get("created_at"):
                created = datetime.fromisoformat(a["created_at"])
                if datetime.utcnow() >= created + timedelta(hours=24):
                    a["status"] = "resolved"; a["agreeVotes"] = 999; room_modified = True
                    target_user = db["users"].find_one({"_id": a["target_email"]})
                    
                    if target_user:
                        t_prof = target_user.get("profile", {})
                        t_noti = target_user.get("noti", [])
                        if a["type"] == "delist":
                            t_prof["status"] = "delisted"; t_prof["price"] = 0
                            t_noti.insert(0, f"🚨 24시간 무응답으로 {a['target_name']}님의 상장폐지 재판이 자동 가결되었습니다.")
                        elif a["type"] == "revival":
                            t_prof["status"] = "active"; t_prof["price"] = 10000
                            t_noti.insert(0, f"🌱 24시간 무응답으로 {a['target_name']}님의 회생 재판이 자동 가결되었습니다.")
                        elif a["type"] == "defense":
                            assoc = a.get("associated_eval", {})
                            base_p = t_prof.get("basePrice", 20000)
                            change_amount = base_p * (assoc.get("intensity", 0) * 0.01)
                            t_prof["price"] = t_prof.get("price", 20000) - change_amount
                            if "priceHistory" not in t_prof: t_prof["priceHistory"] = [base_p]; t_prof["timeHistory"] = ["시작"]
                            t_prof["priceHistory"].append(t_prof["price"])
                            t_prof["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
                            t_noti.insert(0, f"[👎재판 패소] 24시간 무응답으로 악평 확정 (-{assoc.get('intensity', 0)}% 적용)")
                            
                            max_p = t_prof.get("maxPrice", 20000)
                            if t_prof["price"] <= (max_p * 0.3) and not t_prof.get("narackStartTime"):
                                t_prof["narackStartTime"] = datetime.utcnow().isoformat()
                                t_prof["narackLastHitEmail"] = assoc.get("evaluator_email")
                                
                            evaluator_email = assoc.get("evaluator_email")
                            if evaluator_email:
                                eval_user = db["users"].find_one({"_id": evaluator_email})
                                if eval_user:
                                    e_prof = eval_user.get("profile", {})
                                    e_prof["price"] = e_prof.get("price", 20000) + 1000
                                    if "priceHistory" not in e_prof: e_prof["priceHistory"] = [e_prof.get("basePrice", 20000)]; e_prof["timeHistory"] = ["시작"]
                                    e_prof["priceHistory"].append(e_prof["price"])
                                    e_prof["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
                                    e_noti = eval_user.get("noti", [])
                                    e_noti.insert(0, f"💸 [위자료 입금] 24시간 무응답으로 {a['target_name']}님의 방어 재판이 기각되어 위자료 1,000p를 획득했습니다.")
                                    db["users"].update_one({"_id": evaluator_email}, {"$set": {"profile": e_prof, "noti": e_noti}})
                        # ★ [패치] 무응답 자동 가결 시
                        elif a["type"] == "kick":
                            db["rooms"].update_one({"_id": room["_id"]}, {"$pull": {"members": a["target_email"]}})
                            t_noti.insert(0, f"🚪 24시간 무응답으로 클럽에서 내보내졌습니다.")
                            creator_email = a.get("creator_email")
                            if creator_email:
                                c_user = db["users"].find_one({"_id": creator_email})
                                if c_user:
                                    c_noti = c_user.get("noti", [])
                                    c_noti.insert(0, f"🚪 [내보내기 가결] 24시간 무응답으로 내보내기가 자동 가결되었습니다.")
                                    db["users"].update_one({"_id": creator_email}, {"$set": {"noti": c_noti}})
                                    
                        db["users"].update_one({"_id": a["target_email"]}, {"$set": {"profile": t_prof, "noti": t_noti}})
                        
        if room_modified: db["rooms"].update_one({"_id": room["_id"]}, {"$set": {"agendas": room.get("agendas")}})
            
        members_profiles = []
        for member_email in room["members"]:
            m_data = db["users"].find_one({"_id": member_email})
            if m_data and "profile" in m_data:
                prof = m_data["profile"]
                prof["email"] = member_email
                members_profiles.append(prof)
        my_rooms.append({ "room_code": room["_id"], "room_name": room["name"], "members": members_profiles, "agendas": room.get("agendas", []), "messages": room.get("messages", []), "events": room.get("events", []) })

    all_users = list(db["users"].find({}, {"profile": 1}))
    sorted_users = sorted(all_users, key=lambda x: x.get("profile", {}).get("price", 0), reverse=True)[:10]
    global_ranking = [u.get("profile") for u in sorted_users if "profile" in u]
    sys_data = db["system"].find_one({"_id": "global"})
    megaphone_msg = sys_data.get("megaphone", "") if sys_data else ""

    return {"isNewUser": False, "profile": profile, "noti": user_data.get("noti", []), "my_rooms": my_rooms, "global_ranking": global_ranking, "megaphone_msg": megaphone_msg}

@app.post("/api/shop/buy")
def buy_shop_item(data: ShopData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    user = db["users"].find_one({"_id": email})
    if not user: return {"status": "error", "message": "유저 없음"}
    
    profile = user["profile"]
    kst_now = datetime.utcnow() + timedelta(hours=9)
    
    if data.item_type == "shield":
        if profile.get("price", 20000) < 3000: return {"status": "error", "message": "잔고가 부족합니다 (3,000p 필요)."}
        profile["price"] -= 3000
        profile["shieldCount"] = profile.get("shieldCount", 0) + 1
        
        if "priceHistory" not in profile: profile["priceHistory"] = [profile.get("basePrice", 20000)]; profile["timeHistory"] = ["시작"]
        profile["priceHistory"].append(profile["price"]); profile["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
        db["users"].update_one({"_id": email}, {"$set": {"profile": profile}})
        return {"status": "success", "message": "🛡️ 무지개 반사 구매 완료! (악평 1회 자동 방어)"}
        
    elif data.item_type == "megaphone":
        if profile.get("price", 20000) < 1500: return {"status": "error", "message": "잔고가 부족합니다 (1,500p 필요)."}
        if not data.extra_data.strip(): return {"status": "error", "message": "메시지를 입력하세요."}
        
        profile["price"] -= 1500
        if "priceHistory" not in profile: profile["priceHistory"] = [profile.get("basePrice", 20000)]; profile["timeHistory"] = ["시작"]
        profile["priceHistory"].append(profile["price"]); profile["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
        
        db["system"].update_one({"_id": "global"}, {"$set": {"megaphone": f"📢 [{profile.get('name')}] {data.extra_data}"}}, upsert=True)
        db["users"].update_one({"_id": email}, {"$set": {"profile": profile}})
        return {"status": "success", "message": "📢 확성기 사용 완료! 전국구 티커에 등록되었습니다."}
        
    return {"status": "error", "message": "알 수 없는 아이템입니다."}

@app.post("/api/room/gamble")
def room_gamble(data: GambleData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    if is_spamming(email, "gamble", 2): return {"status": "error", "message": "천천히 배팅해주세요."}

    user = db["users"].find_one({"_id": email})
    if not user or user["profile"].get("price", 0) < 500: return {"status": "error", "message": "도박장 입장 최소 금액(500p)이 부족합니다."}

    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "클럽 멤버가 아닙니다."}

    profile = user["profile"]
    dice = random.randint(1, 6)
    is_odd = dice % 2 != 0
    user_guess_odd = data.guess == "홀"

    win = (is_odd and user_guess_odd) or (not is_odd and not user_guess_odd)
    result_str = "홀" if is_odd else "짝"

    kst_now = datetime.utcnow() + timedelta(hours=9)
    time_str = kst_now.strftime("%m.%d %H:%M")

    if win:
        profile["price"] += 500 # 500 내고 1000 받으니 순이익 500
        chat_msg = f"🎰 [도박장] {profile.get('name')}님이 '{data.guess}'에 배팅! ➔ 🎲 {dice} ({result_str}) ➔ 🎉 1,000p 획득!"
        msg = f"🎉 🎲 {dice} ({result_str})! 주사위 게임 승리! 1,000p를 획득하셨습니다!"
    else:
        profile["price"] -= 500
        chat_msg = f"🎰 [도박장] {profile.get('name')}님이 '{data.guess}'에 배팅! ➔ 🎲 {dice} ({result_str}) ➔ 💸 500p 증발..."
        msg = f"💸 🎲 {dice} ({result_str})... 도박 실패. 500p를 잃으셨습니다."

    if "priceHistory" not in profile: profile["priceHistory"] = [profile.get("basePrice", 20000)]; profile["timeHistory"] = ["시작"]
    profile["priceHistory"].append(profile["price"]); profile["timeHistory"].append(time_str)

    db["users"].update_one({"_id": email}, {"$set": {"profile": profile}})
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"messages": {"sender_email": "system", "sender_name": "시스템", "message": chat_msg}}})

    return {"status": "success", "message": msg}

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
        db_profile["badges"] = data.profile.get("badges", db_profile.get("badges", []))
        db_profile["roomAliases"] = data.profile.get("roomAliases", db_profile.get("roomAliases", {}))
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
        profile["goodTickets"] = profile.get("goodTickets", 0) + 1; profile["badTickets"] = profile.get("badTickets", 0) + 1
        profile["dailyAdTicketsCount"] = profile.get("dailyAdTicketsCount", 0) + 1; profile["dailyAdTicketsDate"] = server_today_str
        msg = "🎁 평가권 각 +1장 획득!"
    elif data.reward_type == 'weekly':
        if profile.get("weeklyTicketsClaimed"): return {"status": "error", "message": "이미 완료하셨습니다!"}
        profile["goodTickets"] = profile.get("goodTickets", 0) + 1; profile["badTickets"] = profile.get("badTickets", 0) + 1
        profile["weeklyTicketsClaimed"] = True
        msg = "🎫 주간 보너스 평가권 획득!"

    if profile["price"] > profile.get("maxPrice", 20000): profile["maxPrice"] = profile["price"]
    if data.reward_type in ['attendance', 'double_attendance']:
        if "priceHistory" not in profile: profile["priceHistory"] = [profile.get("basePrice", 20000)]; profile["timeHistory"] = ["시작"]
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
    if is_spamming(email, "evaluate", 3): return {"status": "error", "message": "요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요."}
    if data.intensity not in [1, 2, 3]: return {"status": "error", "message": "올바르지 않은 변동 수치입니다."}

    evaluator = db["users"].find_one({"_id": data.evaluator_email})
    target = db["users"].find_one({"_id": data.target_email})
    if not evaluator or not target: return {"status": "error", "message": "유저 정보 없음"}

    evaluator_name = evaluator.get("profile", {}).get("name", "익명")

    if data.eval_type == 'good':
        if evaluator["profile"].get("goodTickets", 0) <= 0: return {"status": "error", "message": "호평권 부족"}
        evaluator["profile"]["goodTickets"] -= 1; evaluator["profile"]["stats"]["goodGiven"] = evaluator["profile"]["stats"].get("goodGiven", 0) + 1
        db["users"].update_one({"_id": data.evaluator_email}, {"$set": {"profile": evaluator["profile"]}})

        base_price = target["profile"].get("basePrice", 20000)
        change_amount = base_price * (data.intensity * 0.01)
        target["profile"]["price"] += change_amount
        if target["profile"]["price"] > target["profile"].get("maxPrice", 20000): target["profile"]["maxPrice"] = target["profile"]["price"]

        if "priceHistory" not in target["profile"]: target["profile"]["priceHistory"] = [target["profile"].get("basePrice", 20000)]; target["profile"]["timeHistory"] = ["시작"]
        target["profile"]["priceHistory"].append(target["profile"]["price"])
        kst_now = datetime.utcnow() + timedelta(hours=9)
        target["profile"]["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))

        if "noti" not in target: target["noti"] = []
        target["noti"].insert(0, f"[👍호평] {evaluator_name}님의 평가 (+{data.intensity}%): {data.reason}")

        if target["profile"].get("narackStartTime") and target["profile"]["price"] > (target["profile"].get("maxPrice", 20000) * 0.3):
            target["profile"]["narackStartTime"] = None; target["profile"]["narackLastHitEmail"] = None

        db["users"].update_one({"_id": data.target_email}, {"$set": {"profile": target["profile"], "noti": target["noti"]}})
        return {"status": "success", "message": "👍 호평이 즉시 반영되었습니다."}

    else:
        if target["profile"].get("shieldCount", 0) > 0:
            if evaluator["profile"].get("badTickets", 0) <= 0: return {"status": "error", "message": "악평권 부족"}
            evaluator["profile"]["badTickets"] -= 1; evaluator["profile"]["stats"]["badGiven"] = evaluator["profile"]["stats"].get("badGiven", 0) + 1
            db["users"].update_one({"_id": data.evaluator_email}, {"$set": {"profile": evaluator["profile"]}})
            
            target["profile"]["shieldCount"] -= 1
            target_noti = target.get("noti", [])
            target_noti.insert(0, f"🛡️ [무지개 반사 발동!] {evaluator_name}님의 악평(-{data.intensity}%)을 방어권으로 튕겨냈습니다!")
            db["users"].update_one({"_id": data.target_email}, {"$set": {"profile": target["profile"], "noti": target_noti}})
            
            eval_noti = evaluator.get("noti", [])
            eval_noti.insert(0, f"💥 [공격 실패] {target['profile']['name']}님이 '무지개 반사'를 사용하여 악평이 무효화되었습니다!")
            db["users"].update_one({"_id": data.evaluator_email}, {"$set": {"noti": eval_noti}})
            
            return {"status": "success", "message": f"💥 앗! 상대방이 '무지개 반사'를 사용하여 악평이 튕겨나갔습니다!"}

        if evaluator["profile"].get("badTickets", 0) <= 0: return {"status": "error", "message": "악평권 부족"}
        evaluator["profile"]["badTickets"] -= 1; evaluator["profile"]["stats"]["badGiven"] = evaluator["profile"]["stats"].get("badGiven", 0) + 1
        db["users"].update_one({"_id": data.evaluator_email}, {"$set": {"profile": evaluator["profile"]}})

        if "pending_evals" not in target["profile"]: target["profile"]["pending_evals"] = []
        pending_item = { "id": str(uuid.uuid4()), "evaluator_email": data.evaluator_email, "evaluator_name": evaluator_name, "intensity": data.intensity, "reason": data.reason, "timestamp": datetime.utcnow().isoformat() }
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

    kst_now = datetime.utcnow() + timedelta(hours=9)

    if data.action == "approve":
        base_price = profile.get("basePrice", 20000)
        change_amount = base_price * (target_eval["intensity"] * 0.01)
        profile["price"] = profile.get("price", 20000) - change_amount

        if "priceHistory" not in profile: profile["priceHistory"] = [base_price]; profile["timeHistory"] = ["시작"]
        profile["priceHistory"].append(profile["price"]); profile["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))

        if "noti" not in user: user["noti"] = []
        user["noti"].insert(0, f"[👎악평 수락] {target_eval['evaluator_name']}님의 악평(-{target_eval['intensity']}% 적용): {target_eval['reason']}")

        max_p = profile.get("maxPrice", 20000)
        if profile["price"] <= (max_p * 0.3) and not profile.get("narackStartTime"):
            profile["narackStartTime"] = datetime.utcnow().isoformat(); profile["narackLastHitEmail"] = target_eval["evaluator_email"]

        profile["pending_evals"] = [e for e in pending_list if e["id"] != data.eval_id]
        db["users"].update_one({"_id": email}, {"$set": {"profile": profile, "noti": user["noti"]}})
        return {"status": "success", "message": "악평을 승인하여 주가 변동이 최종 반영되었습니다."}

    elif data.action == "defend":
        cur_month = datetime.utcnow().strftime("%Y-%m")
        if profile.get("defense_month") != cur_month: profile["defense_month"] = cur_month; profile["defense_count"] = 0
        if profile.get("defense_count", 0) >= 3: return {"status": "error", "message": "이번 달 방어 재판권(3회)을 전부 소급 사용하셨습니다. 기각 불가."}
        
        common_room = db["rooms"].find_one({"members": {"$all": [email, target_eval["evaluator_email"]]}})
        if not common_room: return {"status": "error", "message": "공격한 유저와 같은 투자 클럽(방)에 소속되어 있지 않아 방어 재판을 개최할 수 없습니다."}
        
        if profile.get("price", 20000) < 1000:
            return {"status": "error", "message": "계좌에 1,000p 이상이 있어야 재판을 발의할 수 있습니다."}
        
        profile["price"] -= 1000
        if "priceHistory" not in profile: profile["priceHistory"] = [profile.get("basePrice", 20000)]; profile["timeHistory"] = ["시작"]
        profile["priceHistory"].append(profile["price"]); profile["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
        
        profile["defense_count"] += 1

        agenda = {
            "id": str(uuid.uuid4()), "creator_email": email, "target_email": email, "target_name": profile.get("name"),
            "type": "defense",
            "reason": f"⚖️ [악평 이의제기 방어 재판] 피고인이 {target_eval['evaluator_name']}님의 악평(-{target_eval['intensity']}%)에 정식 탄핵 요청을 제기했습니다.\n[악평 사유]: {target_eval['reason']}",
            "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active",
            "associated_eval": target_eval, "deposit": 1000,
            "created_at": datetime.utcnow().isoformat() 
        }

        profile["pending_evals"] = [e for e in pending_list if e["id"] != data.eval_id]
        db["rooms"].update_one({"_id": common_room["_id"]}, {"$push": {"agendas": agenda}})
        db["users"].update_one({"_id": email}, {"$set": {"profile": profile}})
        return {"status": "success", "message": f"⚖️ 법정에 탄핵 상정! (소송 비용 1,000p 차감 / 남은 기회: {3 - profile['defense_count']}회)"}

@app.get("/api/check-nickname")
def check_nickname(nickname: str):
    user = db["users"].find_one({"profile.name": nickname})
    if user: return {"available": False, "message": "이미 사용 중인 닉네임입니다."}
    return {"available": True}

@app.post("/api/room/create")
def create_room(data: RoomData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    alphabet = string.ascii_letters + string.digits
    code = ''.join(secrets.choice(alphabet) for _ in range(8))
    db["rooms"].insert_one({"_id": code, "name": data.room_name, "members": [email], "agendas": [], "messages": [], "events": []})
    return {"status": "success", "room_code": code}

@app.post("/api/room/join")
def join_room(data: RoomData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    if is_spamming(email, "join", 2): return {"status": "error", "message": "방 입장 시도가 너무 빠릅니다. 잠시 후 시도해 주세요."}
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room: return {"status": "error", "message": "존재하지 않는 코드입니다."}
    if email not in room.get("members", []): db["rooms"].update_one({"_id": data.room_code}, {"$push": {"members": email}})
    return {"status": "success"}

@app.post("/api/room/leave")
def leave_room(data: RoomData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room: return {"status": "error", "message": "방이 존재하지 않습니다."}
    room_members = room.get("members", [])
    user = db["users"].find_one({"_id": email})
    profile = user.get("profile", {})
    for a in room.get("agendas", []):
        if a.get("status") == "active" and a.get("target_email") == email: return {"status": "error", "message": "🚨 도망 금지: 본인이 회부된 진행 중인 재판이 있어 방을 나갈 수 없습니다."}
    for pe in profile.get("pending_evals", []):
        if pe.get("evaluator_email") in room_members: return {"status": "error", "message": "🚨 도망 금지: 이 방의 멤버가 작성한 결재 대기 중인 악평이 있습니다."}
    if profile.get("narackStartTime") and profile.get("narackLastHitEmail") in room_members: return {"status": "error", "message": "🚨 도망 금지: 상장폐지 심사 대기 중(나락 상태)이므로 방을 나갈 수 없습니다."}
    db["rooms"].update_one({"_id": data.room_code}, {"$pull": {"members": email}})
    return {"status": "success"}

@app.post("/api/room/chat")
def send_chat(data: ChatData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.sender_email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    if is_spamming(email, "chat", 1): return {"status": "error", "message": "채팅 도배 방지! 천천히 입력해 주세요."}
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "해당 클럽의 멤버가 아닙니다."}
    chat_msg = {"sender_email": email, "sender_name": data.sender_name, "message": data.message}
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"messages": chat_msg}})
    return {"status": "success"}

@app.post("/api/room/event/add")
def add_room_event(data: EventAddData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.creator_email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "해당 클럽의 멤버가 아닙니다."}
    event = { "id": str(uuid.uuid4()), "start_date": data.start_date, "end_date": data.end_date, "title": data.title, "creator_email": email, "creator_name": data.creator_name }
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"events": event}})
    return {"status": "success"}

@app.post("/api/room/event/delete")
def delete_room_event(data: EventDeleteData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.deleter_email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "해당 클럽의 멤버가 아닙니다."}
    db["rooms"].update_one({"_id": data.room_code}, {"$pull": {"events": {"id": data.event_id}}})
    return {"status": "success"}

# ★ [패치] 무과금 내보내기 안건 생성
@app.post("/api/agenda/create")
def create_agenda(data: AgendaData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.creator_email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    if is_spamming(email, "agenda", 3): return {"status": "error", "message": "요청이 너무 빠릅니다."}

    user = db["users"].find_one({"_id": email})
    if not user: return {"status": "error", "message": "유저 정보가 없습니다."}

    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "클럽 멤버가 아닙니다."}

    target = db["users"].find_one({"_id": data.target_email})
    target_name = target.get("profile", {}).get("name", "알 수 없음") if target else "알 수 없음"
    profile = user.get("profile", {})

    if data.agenda_type == "kick":
        agenda = {
            "id": str(uuid.uuid4()), "creator_email": email, "target_email": data.target_email, "target_name": target_name,
            "type": data.agenda_type,
            "reason": f"🚪 [클럽 내보내기 투표] {profile.get('name')}님이 {target_name}님을 내보내자고 건의했습니다.\n[사유]: {data.reason}",
            "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active",
            "deposit": 0,
            "created_at": datetime.utcnow().isoformat()
        }
        db["rooms"].update_one({"_id": data.room_code}, {"$push": {"agendas": agenda}})
        return {"status": "success", "message": "🚪 내보내기 투표가 시작되었습니다!"}
        
    return {"status": "error", "message": "잘못된 안건 타입입니다."}

@app.post("/api/agenda/vote")
def vote_agenda(data: VoteData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.voter_email.strip().lower(): return {"status": "error", "message": "인증 실패"}

    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "방이 없거나 해당 클럽의 멤버가 아닙니다."}

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
    kst_now = datetime.utcnow() + timedelta(hours=9)

    # 🚨 가결 시
    if target_agenda["agreeVotes"] >= required_votes:
        target_agenda["status"] = "resolved"
        target_user = db["users"].find_one({"_id": target_agenda["target_email"]})
        
        # ★ [패치] 무과금 내보내기 통과 시
        if target_agenda["type"] == "kick":
            db["rooms"].update_one({"_id": data.room_code}, {"$pull": {"members": target_agenda["target_email"]}})
            
            creator_email = target_agenda.get("creator_email")
            if creator_email:
                c_user = db["users"].find_one({"_id": creator_email})
                if c_user:
                    c_noti = c_user.get("noti", [])
                    c_noti.insert(0, f"🚪 [내보내기 가결] {target_agenda['target_name']}님을 내보내는 안건이 통과되었습니다.")
                    db["users"].update_one({"_id": creator_email}, {"$set": {"noti": c_noti}})
            
            if target_user:
                t_noti = target_user.get("noti", [])
                t_noti.insert(0, f"🚪 [클럽 퇴장] 다수결에 의해 클럽에서 내보내졌습니다.")
                db["users"].update_one({"_id": target_agenda["target_email"]}, {"$set": {"noti": t_noti}})
                
            message = f"🚪 과반수 찬성으로 {target_agenda['target_name']}님이 클럽에서 나갔습니다."

        elif target_user:
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

                if "priceHistory" not in target_user["profile"]: target_user["profile"]["priceHistory"] = [base_p]; target_user["profile"]["timeHistory"] = ["시작"]
                target_user["profile"]["priceHistory"].append(target_user["profile"]["price"])
                target_user["profile"]["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))

                if "noti" not in target_user: target_user["noti"] = []
                target_user["noti"].insert(0, f"[👎재판 패소] 악평 정당화 판결 확정 (-{assoc['intensity']}% 적용): {assoc['reason']}")

                max_p = target_user["profile"].get("maxPrice", 20000)
                if target_user["profile"]["price"] <= (max_p * 0.3) and not target_user["profile"].get("narackStartTime"):
                    target_user["profile"]["narackStartTime"] = datetime.utcnow().isoformat()
                    target_user["profile"]["narackLastHitEmail"] = assoc["evaluator_email"]

                message = f"⚖️ [재판 패소] 배심원단이 악평을 정당하다고 판결했습니다! {target_agenda['target_name']}님의 주가가 하락합니다."
                
                evaluator_email = assoc["evaluator_email"]
                eval_user = db["users"].find_one({"_id": evaluator_email})
                if eval_user:
                    e_prof = eval_user.get("profile", {})
                    e_prof["price"] = e_prof.get("price", 20000) + 1000
                    if "priceHistory" not in e_prof: e_prof["priceHistory"] = [e_prof.get("basePrice", 20000)]; e_prof["timeHistory"] = ["시작"]
                    e_prof["priceHistory"].append(e_prof["price"])
                    e_prof["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
                    e_noti = eval_user.get("noti", [])
                    e_noti.insert(0, f"💸 [위자료 입금] {target_agenda['target_name']}님이 제기한 방어 재판에서 승소하여 위자료 1,000p를 받았습니다!")
                    db["users"].update_one({"_id": evaluator_email}, {"$set": {"profile": e_prof, "noti": e_noti}})

            db["users"].update_one({"_id": target_agenda["target_email"]}, {"$set": {"profile": target_user["profile"], "noti": target_user.get("noti", [])}})
        status_msg = "resolved"

    # ⚖️ 기각 시
    elif target_agenda["disagreeVotes"] >= required_votes:
        target_agenda["status"] = "rejected"; status_msg = "resolved"
        
        # ★ [패치] 무과금 내보내기 부결 시 
        if target_agenda["type"] == "kick":
            target_user = db["users"].find_one({"_id": target_agenda["target_email"]})
            if target_user:
                t_noti = target_user.get("noti", [])
                t_noti.insert(0, f"⚖️ [내보내기 부결] 나를 내보내려던 투표가 부결되었습니다.")
                db["users"].update_one({"_id": target_agenda["target_email"]}, {"$set": {"noti": t_noti}})
            message = f"⚖️ 반대표가 많아 내보내기 안건이 기각되었습니다."
            
        elif target_agenda["type"] == "defense":
            message = f"⚖️ [재판 승소] 배심원단이 기각하여 {target_agenda['target_name']}님이 방어에 성공했습니다! 악평은 무효 소멸됩니다."
            target_user = db["users"].find_one({"_id": target_agenda["target_email"]})
            if target_user:
                t_prof = target_user.get("profile", {})
                t_prof["price"] = t_prof.get("price", 20000) + 1100
                if "priceHistory" not in t_prof: t_prof["priceHistory"] = [t_prof.get("basePrice", 20000)]; t_prof["timeHistory"] = ["시작"]
                t_prof["priceHistory"].append(t_prof["price"])
                t_prof["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
                t_noti = target_user.get("noti", [])
                t_noti.insert(0, f"⚖️ [재판 승소] 방어에 성공하여 소송 비용 환급 및 승소 위자료를 포함해 총 1,100p를 지급받았습니다! 🎉")
                db["users"].update_one({"_id": target_agenda["target_email"]}, {"$set": {"profile": t_prof, "noti": t_noti}})
        else:
            message = f"⚖️ 반대표가 많아 안건이 최종 기각되었습니다."

    db["rooms"].update_one({"_id": data.room_code}, {"$set": {"agendas": agendas}})
    return {"status": status_msg, "message": message}

@app.post("/api/upload")
async def upload_image(image: UploadFile = File(...)):
    if not image.content_type.startswith("image/"): raise HTTPException(status_code=400, detail="이미지 파일만 업로드할 수 있습니다.")
    MAX_SIZE = 5 * 1024 * 1024 
    contents = await image.read()
    if len(contents) > MAX_SIZE: raise HTTPException(status_code=400, detail="파일 크기는 5MB를 초과할 수 없습니다.")
    import base64
    img_b64 = base64.b64encode(contents).decode("utf-8")
    api_key = os.getenv("IMGBB_API_KEY")
    async with httpx.AsyncClient() as client: res = await client.post(f"https://api.imgbb.com/1/upload?key={api_key}", data={"image": img_b64})
    data = res.json()
    if data.get("success"): return {"url": data["data"]["url"]}
    return {"error": "업로드 실패"}