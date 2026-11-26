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
from pywebpush import webpush, WebPushException
import json
import re
from urllib.parse import urlparse
import asyncio
from pymongo import ReturnDocument
from contextlib import asynccontextmanager
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

load_dotenv()

# 🔥 추가된 부분: 백그라운드 작업을 관리하는 Lifespan 매니저
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 서버가 시작될 때 스케줄러 태스크 실행
    task = asyncio.create_task(run_background_scheduler())
    yield
    # 서버가 종료될 때 태스크 취소
    task.cancel()

# 기존 app = FastAPI() 를 아래와 같이 수정
app = FastAPI(lifespan=lifespan)

def mission_week_monday(kst_now: datetime) -> str:
    """미션 주간의 시작(가장 최근 월요일 08시, KST)의 날짜를 돌려줍니다. 월요일 08시 전이면 지난주 월요일."""
    days_since_monday = kst_now.weekday()
    if days_since_monday == 0 and kst_now.hour < 8: days_since_monday = 7
    return (kst_now - timedelta(days=days_since_monday)).strftime("%Y-%m-%d")


def mission_for_client(mission, my_email: str):
    """화면의 미션 카드에 필요한 정보만 골라, 마감 시각과 내 기여도를 붙여 돌려줍니다."""
    if not mission: return None
    week_start = datetime.strptime(mission_week_monday(datetime.utcnow() + timedelta(hours=9)), "%Y-%m-%d")
    ends_at_utc = week_start + timedelta(days=7, hours=8) - timedelta(hours=9)  # 다음 월요일 08:00 KST
    contributions = mission.get("contributions", {})
    return {
        "type": mission.get("type"), "name": mission.get("name"), "description": mission.get("description"),
        "target_score": mission.get("target_score", 1), "total_score": mission.get("total_score", 0),
        "reward_points": mission.get("reward_points", 0), "reward_tickets": mission.get("reward_tickets", 0),
        "contributions": contributions, "my_contribution": contributions.get(my_email, 0),
        "ends_at": ends_at_utc.isoformat() + "Z",
    }


async def run_background_scheduler():
    """10분마다 만료된 악평과 재판을 검사하고 강제 집행하는 봇"""
    while True:
        try:
            kst_now = datetime.utcnow() + timedelta(hours=9)

            kst_today_str = kst_now.strftime("%Y-%m-%d")
            sys_data = db["system"].find_one({"_id": "global"}) or {}
            
            # 오늘 날짜의 이벤트가 아직 안 뽑혔다면 새로 추첨!
            if sys_data.get("daily_event_date") != kst_today_str:
                events = [
                    {"id": "bull", "msg": "🐂 [불장] 오늘 하루 출석체크 보상이 3배(150p)로 폭등합니다!"},
                    {"id": "bear", "msg": "🐻 [베어 마켓] 오늘 하루 악평 피격 시 주가 하락폭이 1.5배 증가합니다!"},
                    {"id": "angel", "msg": "👼 [천사의 날] 오늘 하루 호평 시 주가 상승폭이 1.5배 증가합니다!"},
                    {"id": "none", "msg": "☁️ [평온한 하루] 오늘은 특별한 경제 이벤트가 없습니다."}
                ]
                today_event = random.choice(events)
                db["system"].update_one(
                    {"_id": "global"},
                    {"$set": {
                        "daily_event_date": kst_today_str,
                        "daily_event_id": today_event["id"],
                        "daily_event_msg": today_event["msg"]
                    }},
                    upsert=True
                )
            
            # 1. 만료된 악평(pending_evals) 검사 및 강제 수락
            for user in db["users"].find({"profile.pending_evals": {"$exists": True, "$not": {"$size": 0}}}):
                email = user["_id"]
                profile = user.get("profile", {})
                pending_list = profile.get("pending_evals", [])
                new_pending = []
                profile_modified = False
                
                for e in pending_list:
                    created = parse_time_safe(e.get("timestamp"))
                    if created and datetime.utcnow() >= created + timedelta(hours=24):
                        base_p = profile.get("basePrice", 20000)
                        change_amount = base_p * (e["intensity"] * 0.01)
                        profile["price"] = profile.get("price", 20000) - change_amount
                        
                        if "priceHistory" not in profile: 
                            profile["priceHistory"] = [base_p]
                            profile["timeHistory"] = ["시작"]
                        profile["priceHistory"].append(profile["price"])
                        profile["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
                        
                        noti_list = user.get("noti", [])
                        msg = f"⏳ [자동 수락] 24시간 무응답으로 {e['evaluator_name']}님의 악평 강제 승인 (-{e['intensity']}% 적용)"
                        noti_list.insert(0, msg)
                        
                        max_p = profile.get("maxPrice", 20000)
                        if profile["price"] <= (max_p * 0.3) and not profile.get("narackStartTime"):
                            profile["narackStartTime"] = datetime.utcnow().isoformat()
                            profile["narackLastHitEmail"] = e["evaluator_email"]
                            
                        profile_modified = True
                        
                        # 푸시 알림 전송 시도
                        send_push_notification(email, "⏳ 악평 자동 수락", "24시간이 경과하여 악평이 자동 반영되었습니다.")
                    else:
                        new_pending.append(e)
                
                if profile_modified:
                    profile["pending_evals"] = new_pending
                    db["users"].update_one({"_id": email}, {"$set": {"profile": profile, "noti": noti_list}})

            # 2. 만료된 재판(agendas) 검사 및 강제 종결
            for room in db["rooms"].find({"agendas": {"$exists": True, "$not": {"$size": 0}}}):
                room_modified = False
                surviving_agendas = []
                
                for a in room.get("agendas", []):
                    created = parse_time_safe(a.get("created_at"))
                    
                    # 48시간 지난 기록은 삭제
                    if created and datetime.utcnow() >= created + timedelta(hours=48):
                        room_modified = True
                        continue
                        
                    # 24시간 지났고 아직 진행 중(active)인 재판 강제 가결
                    if a.get("status") == "active" and created and datetime.utcnow() >= created + timedelta(hours=24):
                        a["status"] = "resolved"
                        a["agreeVotes"] = 999  # 압도적 찬성으로 처리
                        room_modified = True
                        
                        target_user = db["users"].find_one({"_id": a["target_email"]})
                        if target_user:
                            t_prof = target_user.get("profile", {})
                            t_noti = target_user.get("noti", [])
                            
                            if a["type"] == "delist":
                                t_prof["status"] = "delisted"
                                t_prof["price"] = 0
                                t_noti.insert(0, f"💀 [상장폐지] 24시간 무응답으로 상장폐지 재판이 자동 가결되었습니다.")
                                send_push_notification(a["target_email"], "💀 상장폐지 확정", "재판에서 패소하여 상장폐지 되었습니다.")
                                
                            elif a["type"] == "revival":
                                t_prof["status"] = "active"
                                t_prof["price"] = 10000
                                t_noti.insert(0, f"🌱 [회생 가결] 24시간 무응답으로 회생 재판이 자동 가결되었습니다.")
                                
                            elif a["type"] == "kick":
                                db["rooms"].update_one({"_id": room["_id"]}, {"$pull": {"members": a["target_email"]}})
                                t_noti.insert(0, f"🚪 [클럽 퇴장] 24시간 무응답으로 클럽에서 내보내졌습니다.")
                                
                            elif a["type"] == "defense":
                                # 방어 재판도 24시간 무응답이면 '악평 정당' 판결로 처리 (소송비만 날아가던 버그 수정)
                                apply_defense_loss(a, target_user, kst_now)
                                t_noti = target_user["noti"]
                                send_push_notification(a["target_email"], "⚖️ 방어 재판 종료", "24시간 동안 결론이 나지 않아 악평이 반영되었습니다.")
                            
                            db["users"].update_one({"_id": a["target_email"]}, {"$set": {"profile": t_prof, "noti": t_noti}})
                            
                    surviving_agendas.append(a)
                    
                if room_modified:
                    db["rooms"].update_one({"_id": room["_id"]}, {"$set": {"agendas": surviving_agendas}})

            # 🔥 3. 주간 클럽 미션 정산 및 신규 할당
            #    '오늘이 월요일인가'가 아니라 '이번 주 월요일 08시가 지났는데 아직 갱신 안 했나'로 검사합니다.
            #    (무료 서버가 월요일 내내 잠들어 있어도, 그 주에 처음 깨어났을 때 갱신·정산됩니다)
            current_monday_str = mission_week_monday(kst_now)
            
            # 이번 주 월요일에 이미 미션 갱신을 완료했는지 확인 (중복 방지)
            if sys_data.get("last_mission_reset_date") != current_monday_str:
                
                for room in db["rooms"].find():
                    members = room.get("members", [])
                    if len(members) < 2:
                        continue  # 1인 클럽은 미션에서 완전히 제외합니다.
                        
                    # [A] 기존 미션 정산 로직
                    current_mission = room.get("current_mission")
                    if current_mission:
                        t_score = current_mission.get("total_score", 0)
                        target = current_mission.get("target_score", 1)
                        
                        if t_score >= target:
                            # 성공 시 기여도 비례 보상 분배
                            reward_p = current_mission.get("reward_points", 0)
                            reward_t = current_mission.get("reward_tickets", 0)
                            conts = current_mission.get("contributions", {})
                            
                            for mem_email, score in conts.items():
                                if score > 0:
                                    ratio = score / t_score
                                    earned_p = int(reward_p * ratio)
                                    earned_t = int(reward_t * ratio)
                                    
                                    # 유저 DB에 보상 지급
                                    m_user = db["users"].find_one({"_id": mem_email})
                                    if m_user:
                                        m_prof = m_user.get("profile", {})
                                        m_prof["price"] = m_prof.get("price", 20000) + earned_p
                                        m_prof["goodTickets"] = m_prof.get("goodTickets", 0) + earned_t
                                        m_prof["badTickets"] = m_prof.get("badTickets", 0) + earned_t
                                        
                                        m_noti = m_user.get("noti", [])
                                        m_noti.insert(0, f"🎉 [미션 성공] '{current_mission['name']}' 기여도 {int(ratio*100)}% 달성! (+{earned_p}p, 평가권 각 +{earned_t}장)")
                                        db["users"].update_one({"_id": mem_email}, {"$set": {"profile": m_prof, "noti": m_noti}})
                            
                            # 성공 시스템 채팅
                            db["rooms"].update_one({"_id": room["_id"]}, {"$push": {"messages": {"$each": [{"sender_email": "system", "sender_name": "시스템", "message": f"🎉 지난주 클럽 미션을 달성했습니다! 참여자들에게 기여도 비례 보상이 지급되었습니다.", "is_megaphone": False, "timestamp": datetime.utcnow().isoformat()}], "$slice": -MAX_ROOM_MESSAGES}}})
                        else:
                            # 실패 시스템 채팅
                            db["rooms"].update_one({"_id": room["_id"]}, {"$push": {"messages": {"$each": [{"sender_email": "system", "sender_name": "시스템", "message": f"💦 아쉽게도 지난주 클럽 미션 목표 달성에 실패했습니다.", "is_megaphone": False, "timestamp": datetime.utcnow().isoformat()}], "$slice": -MAX_ROOM_MESSAGES}}})
                    
                    # [B] 신규 미션 무작위 할당 로직
                    new_m = random.choice(MISSIONS_POOL)
                    
                    # 인원수 비례 동적 난이도 계산 (소수점은 반올림 처리)
                    target_score = max(1, int(new_m["base_target_per_user"] * len(members)))
                    total_reward_p = int(new_m["reward_points"] * len(members))
                    total_reward_t = int(new_m["reward_tickets"] * len(members))
                    
                    mission_doc = {
                        "type": new_m["type"],
                        "name": new_m["name"],
                        "description": new_m["description"],
                        "target_score": target_score,
                        "total_score": 0,
                        "reward_points": total_reward_p,
                        "reward_tickets": total_reward_t,
                        "contributions": {m: 0 for m in members}
                    }
                    
                    db["rooms"].update_one({"_id": room["_id"]}, {"$set": {"current_mission": mission_doc}})
                    
                    # 신규 미션 시작 시스템 채팅
                    db["rooms"].update_one({"_id": room["_id"]}, {"$push": {"messages": {"$each": [{"sender_email": "system", "sender_name": "시스템", "message": f"🔔 이번 주 주간 미션: [{new_m['name']}]\n목표: 총 {target_score}회 달성\n내용: {new_m['description']}", "is_megaphone": False, "timestamp": datetime.utcnow().isoformat()}], "$slice": -MAX_ROOM_MESSAGES}}})
                
                # 모든 방의 처리가 끝나면 글로벌 플래그 업데이트
                db["system"].update_one({"_id": "global"}, {"$set": {"last_mission_reset_date": current_monday_str}}, upsert=True)

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Scheduler Error: {e}")
        # 다음 검사까지 10분 대기 (서버가 켜지면 기다리지 않고 바로 첫 검사를 합니다)
        await asyncio.sleep(600)

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

# 🔥 [신규 추가] VAPID 비공개 키 및 푸시 발송 함수
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_CLAIMS = {"sub": "mailto:shkang04120@gmail.com"}

def send_push_notification(target_email: str, title: str, body: str):
    # 유저 DB에서 스마트폰 주소(push_subscription) 가져오기
    user = db["users"].find_one({"_id": target_email})
    if not user or "push_subscription" not in user:
        return False
    
    try:
        webpush(
            subscription_info=user["push_subscription"],
            data=json.dumps({"title": title, "body": body}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS
        )
        return True
    except WebPushException as ex:
        # 유저가 알림을 차단했거나 앱을 지웠다면 DB에서 주소 삭제
        if ex.response and ex.response.status_code == 410:
            db["users"].update_one({"_id": target_email}, {"$unset": {"push_subscription": ""}})
        return False

# 🔥 상점 가격표 (1원 = 2p 환율 적용)
SHOP_PRICES = {
    "fund_pack": {"cash": 5000, "point_reward": 10000},
    "megaphone": {"point": 2000, "cash": 1000},
    "anon_ticket": {"point": 5000, "cash": 2500},
    "shield_ticket": {"point": 5000, "cash": 2500},
    "club_megaphone": {"point": 1000, "cash": 500},
    "nickname_color_ticket": {"point": 2000, "cash": 1000}
}

# 🔥 주간 클럽 미션 8종 풀 (인원수 비례 난이도 및 보상 밸런싱)
MISSIONS_POOL = [
    {"type": "use_eval_tickets", "name": "냉혹한 평가단", "description": "클럽원 모두가 힘을 합쳐 다른 사람들을 쉼 없이 평가하세요!", "base_target_per_user": 4, "reward_points": 1000, "reward_tickets": 1},
    {"type": "participate_vote", "name": "법정 단골손님", "description": "클럽 내 재판이 열리면 적극적으로 투표에 참여하여 판결을 내리세요!", "base_target_per_user": 2, "reward_points": 800, "reward_tickets": 0},
    {"type": "win_gamble", "name": "타짜의 품격", "description": "라운지 도박장에서 승리를 쟁취하여 클럽의 자본을 불리세요!", "base_target_per_user": 2, "reward_points": 1500, "reward_tickets": 0},
    {"type": "buy_shop_item", "name": "소비의 미학", "description": "포인트 상점과 캐시 상점에서 아이템을 적극적으로 구매하세요!", "base_target_per_user": 1, "reward_points": 0, "reward_tickets": 2},
    {"type": "daily_attendance", "name": "개미들의 성실함", "description": "클럽원 모두가 매일 꾸준히 접속하여 출석체크 보상을 획득하세요!", "base_target_per_user": 5, "reward_points": 1000, "reward_tickets": 0},
    {"type": "use_megaphone", "name": "확성기 플렉스", "description": "클럽 확성기를 사용하여 시선이 집중되는 화려한 메시지를 남겨보세요!", "base_target_per_user": 1, "reward_points": 800, "reward_tickets": 1},
    {"type": "use_anon_ticket", "name": "어둠의 형제들", "description": "정체를 숨기고 '익명 암살권'을 사용하여 은밀하게 악평을 남기세요!", "base_target_per_user": 1, "reward_points": 1500, "reward_tickets": 1},
    {"type": "open_defense_trial", "name": "진실을 밝히는 자", "description": "억울한 악평에 맞서 1,000p를 소모하여 '이의제기 방어 재판'을 개최하세요!", "base_target_per_user": 0.5, "reward_points": 3000, "reward_tickets": 2}
]

class EvalData(BaseModel):
    evaluator_email: str
    target_email: str
    eval_type: str
    intensity: int
    reason: str = Field("", max_length=500)
    is_anonymous: bool = False

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

class CashShopData(BaseModel):
    email: str
    item_type: str
    extra_data: str = ""

class GambleData(BaseModel):
    room_code: str
    email: str
    guess: str

class PushSubscriptionData(BaseModel):
    endpoint: str
    expirationTime: str | None = None
    keys: dict

api_cooldowns = { "chat": {}, "evaluate": {}, "agenda": {}, "join": {}, "gamble": {} }

def is_spamming(email: str, action_type: str, cooldown_seconds: int) -> bool:
    now = datetime.utcnow()
    if len(api_cooldowns[action_type]) > 500:
        expired_keys = [k for k, v in api_cooldowns[action_type].items() if (now - v).total_seconds() >= cooldown_seconds]
        for k in expired_keys:
            del api_cooldowns[action_type][k]
    last_time = api_cooldowns[action_type].get(email)
    if last_time and (now - last_time).total_seconds() < cooldown_seconds: 
        return True 
    api_cooldowns[action_type][email] = now
    return False

def verify_google_token(auth_header: str):
    """구글 서버 통신 없이 로컬에서 JWT 서명을 고속 검증하는 함수"""
    if not auth_header or not auth_header.startswith("Bearer "): 
        return None
        
    token = auth_header.split(" ")[1]
    
    try:
        # 프론트엔드 코드(app.js)에 있는 본인의 Google Client ID
        CLIENT_ID = "837250448431-hrlfbnof2bf4acofs03e28t3qdpkun5g.apps.googleusercontent.com"
        
        # 구글 서버로 네트워크 요청을 보내는 대신, 캐싱된 공개키로 즉시 서명 검증
        idinfo = id_token.verify_oauth2_token(
            token, 
            google_requests.Request(), 
            CLIENT_ID
        )
        
        # 🔒 구글이 소유를 확인한 이메일만 인정 (남의 이메일로 만든 미인증 구글 계정 차단)
        if not idinfo.get("email") or not idinfo.get("email_verified"):
            return None
        return idinfo.get("email").strip().lower()
        
    except ValueError:
        # 토큰 만료 또는 서명 위조 시 차단
        return None
    except Exception as e:
        print(f"Token Verification Error: {e}")
        return None

def parse_time_safe(time_str):
    if not time_str: return None
    try:
        clean_str = time_str.replace("Z", "+00:00")
        return datetime.fromisoformat(clean_str)
    except Exception:
        return None

MAX_ROOM_MESSAGES = 300  # 방마다 최근 채팅 300개만 보관

# 🔒 [보안 헬퍼] 사용자가 보낸 값이 화면에 그대로 찍혀도 안전한지 검사합니다.
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
NICKNAME_RE = re.compile(r"^[a-zA-Z0-9가-힣]{2,8}$")
SAFE_URL_RE = re.compile(r"^https://[^\s\"'<>`]+$")

def is_valid_hex_color(color) -> bool:
    return isinstance(color, str) and bool(HEX_COLOR_RE.match(color))

def is_valid_nickname(name) -> bool:
    return isinstance(name, str) and bool(NICKNAME_RE.match(name))

def is_safe_image_url(url) -> bool:
    return isinstance(url, str) and len(url) <= 500 and bool(SAFE_URL_RE.match(url))

# 🔒 다른 사람에게 보여주면 안 되는 프로필 필드 (익명 공격자 이메일, 보유 아이템, 개인 설정 등)
PRIVATE_PROFILE_FIELDS = {
    "pending_evals", "narackLastHitEmail", "anonTickets", "shieldCount", "clubMegaphones",
    "nickname_color_tickets", "roomAliases", "goodTickets", "badTickets",
    "lastDailyAttendance", "lastDailyAdBonus", "lastAdTicketMonday", "weeklyTicketsClaimed",
    "lastRefillMonday", "defense_count", "defense_month",
}

def public_profile(prof: dict) -> dict:
    return {k: v for k, v in prof.items() if k not in PRIVATE_PROFILE_FIELDS}

def hide_anonymous_evaluators(prof: dict) -> dict:
    """내 악평 대기열에서 익명 공격자의 이메일을 지운 사본을 돌려줍니다."""
    safe = dict(prof)
    safe["pending_evals"] = [
        {k: v for k, v in e.items() if k != "evaluator_email"} if e.get("evaluator_name") == "익명(???)" else e
        for e in prof.get("pending_evals", [])
    ]
    return safe

def apply_defense_loss(target_agenda: dict, target_user: dict, kst_now: datetime):
    """방어 재판 패소: 피고에게 악평을 반영하고(저장은 호출한 쪽에서), 공격자에게 위자료 1,000p 지급"""
    assoc = target_agenda["associated_eval"]
    prof = target_user["profile"]
    base_p = prof.get("basePrice", 20000)
    prof["price"] = prof.get("price", 20000) - base_p * (assoc["intensity"] * 0.01)

    if "priceHistory" not in prof: prof["priceHistory"] = [base_p]; prof["timeHistory"] = ["시작"]
    prof["priceHistory"].append(prof["price"])
    prof["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))

    target_user.setdefault("noti", []).insert(0, f"⚖️ [재판 패소] 악평 정당화 판결 확정 (-{assoc['intensity']}% 적용): {assoc['reason']}")

    if prof["price"] <= (prof.get("maxPrice", 20000) * 0.3) and not prof.get("narackStartTime"):
        prof["narackStartTime"] = datetime.utcnow().isoformat()
        prof["narackLastHitEmail"] = assoc["evaluator_email"]

    evaluator_email = assoc.get("evaluator_email")
    if evaluator_email and evaluator_email != "anonymous@system.com":
        # 위자료는 원자적으로 지급 (공격자의 다른 데이터를 덮어쓰지 않음)
        e_user = db["users"].find_one_and_update(
            {"_id": evaluator_email},
            {"$inc": {"profile.price": 1000},
             "$push": {"noti": {"$each": [f"💸 [위자료 입금] {target_agenda['target_name']}님이 제기한 방어 재판에서 승소하여 위자료 1,000p를 받았습니다!"], "$position": 0}}},
            return_document=ReturnDocument.AFTER
        )
        if e_user:
            db["users"].update_one({"_id": evaluator_email},
                                   {"$push": {"profile.priceHistory": e_user["profile"]["price"], "profile.timeHistory": kst_now.strftime("%m.%d %H:%M")}})

# 🔥 [미션 헬퍼 함수] 유저가 미션 행동을 하면 소속된 모든 클럽의 점수를 올려줍니다.
def update_mission_progress(user_email: str, mission_type: str, amount: int = 1):
    # 유저가 속한 모든 방을 찾습니다.
    for room in db["rooms"].find({"members": user_email}, {"_id": 1}):
        # 동시에 여러 명이 행동해도 점수가 사라지지 않도록, 읽은 값 그대로일 때만 저장(실패하면 재시도)
        # (충돌해도 매번 누군가 한 명은 성공하므로, 동시 요청 수보다 넉넉하게 재시도)
        for _ in range(50):
            fresh = db["rooms"].find_one({"_id": room["_id"]}, {"current_mission": 1})
            current_mission = (fresh or {}).get("current_mission")
            # 방에 미션이 있고, 그 미션 타입이 방금 한 행동과 일치하며, 아직 목표 미달일 때만
            if not current_mission or current_mission.get("type") != mission_type:
                break
            old_total = current_mission["total_score"]
            if old_total >= current_mission["target_score"]:
                break

            current_mission["total_score"] = old_total + amount
            # 내 기여도 점수 올려주기 (딕셔너리에 없으면 0으로 초기화 후 더함)
            current_mission["contributions"][user_email] = current_mission["contributions"].get(user_email, 0) + amount

            result = db["rooms"].update_one(
                {"_id": room["_id"], "current_mission.type": mission_type, "current_mission.total_score": old_total},
                {"$set": {"current_mission": current_mission}}
            )
            if result.modified_count == 1:
                break

@app.get("/api/data")
def get_user_data(authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email: return {"status": "unauthenticated", "message": "인증 실패"}

    user_data = db["users"].find_one({"_id": email})
    if not user_data: return {"isNewUser": True, "profile": {}, "noti": [], "my_rooms": [], "global_ranking": []}

    profile = user_data.get("profile", {})
    profile_modified = False

    owned_titles = profile.get("titles", ["초보 투자자", "눈팅족", "주린이"])
    stats = profile.get("stats", {})
    new_titles = []
    
    # [업적 조건 검사]
    good_given = stats.get("goodGiven", 0)
    bad_given = stats.get("badGiven", 0)
    current_price = profile.get("price", 20000)
    max_price = profile.get("maxPrice", 20000)
    shield_count = profile.get("shieldCount", 0)
    anon_tickets = profile.get("anonTickets", 0)
    owned_themes = profile.get("ownedThemes", [])
    pending_evals = profile.get("pending_evals", [])
    defense_count = profile.get("defense_count", 0)

    # 1. 기존 조건 (5종)
    if good_given >= 15 and "날개 잃은 천사" not in owned_titles: new_titles.append("날개 잃은 천사")
    if bad_given >= 15 and "어둠의 암살자" not in owned_titles: new_titles.append("어둠의 암살자")
    if anon_tickets >= 10 and "스파이" not in owned_titles: new_titles.append("스파이")
    if current_price >= 50000 and "워렌 버핏" not in owned_titles: new_titles.append("워렌 버핏")
    if current_price <= 5000 and "지하암반수" not in owned_titles: new_titles.append("지하암반수")

    # 2. 신규 평가 성향 조건
    if good_given >= 40 and "평화주의자" not in owned_titles: new_titles.append("평화주의자")
    if bad_given >= 40 and "냉혹한 심판관" not in owned_titles: new_titles.append("냉혹한 심판관")
    if (good_given + bad_given) >= 80 and "프로 평가러" not in owned_titles: new_titles.append("프로 평가러")
    if good_given >= 10 and bad_given >= 30 and "회색분자" not in owned_titles: new_titles.append("회색분자")

    # 3. 신규 자산 규모 조건
    if current_price >= 100000 and "만수르" not in owned_titles: new_titles.append("만수르")
    if current_price <= 1000 and "휴지조각" not in owned_titles: new_titles.append("휴지조각")
    if max_price >= 50000 and current_price <= 20000 and "롤러코스터" not in owned_titles: new_titles.append("롤러코스터")

    # 4. 신규 아이템/테마/위기 조건
    if shield_count >= 7 and "절대 방어" not in owned_titles: new_titles.append("절대 방어")
    if anon_tickets >= 10 and "그림자 군주" not in owned_titles: new_titles.append("그림자 군주")
    if len(owned_themes) >= 3 and "트렌드 세터" not in owned_titles: new_titles.append("트렌드 세터")
    if defense_count >= 5 and "법정 단골" not in owned_titles: new_titles.append("법정 단골")
    if len(pending_evals) >= 4 and "도마 위의 생선" not in owned_titles: new_titles.append("도마 위의 생선")
    
    if new_titles:
        owned_titles.extend(new_titles)
        profile["titles"] = owned_titles
        profile_modified = True
        if "noti" not in user_data: user_data["noti"] = []
        for t in new_titles:
            user_data["noti"].insert(0, f"🏅 [업적 달성] 새로운 칭호 '{t}'을(를) 획득했습니다! 프로필에서 장착해보세요.")

    # 🔥 알림이 15개가 넘어가면 가장 오래된 것부터 슬라이스 후 자동 저장
    if "noti" in user_data and len(user_data["noti"]) > 15:
        user_data["noti"] = user_data["noti"][:15]
        profile_modified = True

    kst_now = datetime.utcnow() + timedelta(hours=9)
    days_since_monday = kst_now.weekday()
    if kst_now.weekday() == 0 and kst_now.hour < 8: days_since_monday = 7
    recent_monday = (kst_now - timedelta(days=days_since_monday)).strftime("%Y-%m-%d")
    
    # 월요일 오전 8시 평가권 리필 체크
    if profile.get("lastRefillMonday") != recent_monday:
        profile["goodTickets"] = 2; profile["badTickets"] = 2
        profile["weeklyTicketsClaimed"] = False; profile["lastRefillMonday"] = recent_monday
        profile_modified = True
        
    # 데이터 수정 사항이 있을 때만 가볍게 DB 업데이트
    if profile_modified:
        db["users"].update_one({"_id": email}, {"$set": {"profile": profile, "noti": user_data.get("noti", [])}})

    # 나락 상태 30일 지속 시 시스템 재판 자동 상정 로직 (기존 유지)
    if profile.get("narackStartTime") and profile.get("narackLastHitEmail"):
        start_time = parse_time_safe(profile["narackStartTime"])
        if start_time and datetime.utcnow() >= start_time + timedelta(days=30):
            last_hit_email = profile["narackLastHitEmail"]
            common_room = db["rooms"].find_one({"members": {"$all": [email, last_hit_email]}})
            if common_room:
                agenda = {
                    "id": str(uuid.uuid4()), "creator_email": "system", "target_email": email,
                    "target_name": profile.get("name", "알 수 없음"), "type": "delist",
                    "reason": f"[시스템 자동 상정] 최고 주가 대비 -70% 이하의 나락 상태에서 30일 동안 탈출하지 못했습니다. (마지막 타격자: {last_hit_email})",
                    "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active",
                    "created_at": datetime.utcnow().isoformat()
                }
                db["rooms"].update_one({"_id": common_room["_id"]}, {"$push": {"agendas": agenda}})
                profile["narackStartTime"] = None; profile["narackLastHitEmail"] = None
                db["users"].update_one({"_id": email}, {"$set": {"profile": profile}})

    # 유저가 참여 중인 클럽 방 정보 가공 (시간 검사 코드가 삭제되어 매우 가벼워짐!)
    my_rooms_cursor = db["rooms"].find({"members": email})
    my_rooms = []
    
    for room in my_rooms_cursor:
        members_profiles = []
        for member_email in room["members"]:
            m_data = db["users"].find_one({"_id": member_email})
            if m_data and "profile" in m_data:
                prof = public_profile(m_data["profile"])
                prof["email"] = member_email
                members_profiles.append(prof)
        my_rooms.append({ 
            "room_code": room["_id"], 
            "room_name": room["name"], 
            "members": members_profiles, 
            "agendas": room.get("agendas", []), 
            "messages": room.get("messages", []), 
            "events": room.get("events", []),
            "current_mission": mission_for_client(room.get("current_mission"), email)
        })

    # 전국구 통합 랭킹 Top 10 가공
    all_users = list(db["users"].find({}, {"profile": 1}))
    sorted_users = sorted(all_users, key=lambda x: x.get("profile", {}).get("price", 0), reverse=True)[:10]
    global_ranking = [public_profile(u.get("profile")) for u in sorted_users if "profile" in u]
    
    # 글로벌 확성기 1시간 만료 체크
    sys_data = db["system"].find_one({"_id": "global"})
    megaphone_msg = ""
    if sys_data and sys_data.get("megaphone"):
        mega_time_str = sys_data.get("megaphone_time")
        if mega_time_str:
            mega_time = parse_time_safe(mega_time_str)
            if mega_time and datetime.utcnow() <= mega_time + timedelta(hours=1):
                megaphone_msg = sys_data.get("megaphone")
            else:
                db["system"].update_one({"_id": "global"}, {"$set": {"megaphone": "", "megaphone_time": None}})

    daily_event_msg = sys_data.get("daily_event_msg", "") if sys_data else ""
    return {
        "isNewUser": False, "profile": hide_anonymous_evaluators(profile), "noti": user_data.get("noti", []),
        "my_rooms": my_rooms, "global_ranking": global_ranking, "megaphone_msg": megaphone_msg,
        "daily_event_msg": daily_event_msg # 🔥 이벤트 속보 데이터 추가
    }

@app.post("/api/save")
def save_user_data(data: UserData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email: return {"status": "error", "message": "인증 실패"}
    
    user = db["users"].find_one({"_id": email})
    # 기존 유저가 있으면 프로필 가져오기, 없으면 빈 딕셔너리 생성
    db_profile = user.get("profile", {}) if user else {}
    
    # 🔥 보안 포인트: 허용된 필드만, 검사를 통과한 값만 골라서 업데이트
    # 유저가 강제로 price나 tickets를 조작해서 보내도 여기서 걸러지면 서버는 무시합니다.
    # (nameColor는 '닉네임 컬러 변경권', ownedThemes는 상점 구매로만 바뀝니다)
    incoming = data.profile
    updates = {}

    if "name" in incoming and incoming["name"] != db_profile.get("name"):
        name = incoming["name"].strip() if isinstance(incoming["name"], str) else ""
        if not is_valid_nickname(name):
            return {"status": "error", "message": "닉네임은 2~8자의 한글/영문/숫자만 가능합니다."}
        if db["users"].find_one({"profile.name": name, "_id": {"$ne": email}}):
            return {"status": "error", "message": "이미 사용 중인 닉네임입니다."}
        updates["profile.name"] = name

    if "profileImage" in incoming and incoming["profileImage"] != db_profile.get("profileImage"):
        if incoming["profileImage"] and not is_safe_image_url(incoming["profileImage"]):
            return {"status": "error", "message": "올바르지 않은 프로필 이미지 주소입니다."}
        updates["profile.profileImage"] = incoming["profileImage"] or ""

    if "profileTheme" in incoming and incoming["profileTheme"] != db_profile.get("profileTheme"):
        theme = incoming["profileTheme"]
        if theme != "none" and theme not in db_profile.get("ownedThemes", []):
            return {"status": "error", "message": "보유하지 않은 테마입니다."}
        updates["profile.profileTheme"] = theme

    if "roomAliases" in incoming:
        aliases = incoming["roomAliases"]
        if not isinstance(aliases, dict) or len(aliases) > 100 or not all(
            isinstance(k, str) and isinstance(v, str) and len(k) <= 20 and len(v) <= 30 for k, v in aliases.items()
        ):
            return {"status": "error", "message": "올바르지 않은 방 별명입니다."}
        updates["profile.roomAliases"] = aliases

    if not user:
        # 신규 가입자는 닉네임이 반드시 있어야 합니다.
        if "profile.name" not in updates:
            return {"status": "error", "message": "닉네임을 설정해 주세요."}
        db["users"].update_one({"_id": email}, {"$set": updates, "$setOnInsert": {"noti": []}}, upsert=True)
    elif updates:
        # 바뀐 필드만 저장해서, 같은 순간 서버가 올린 포인트·알림을 덮어쓰지 않게 합니다.
        db["users"].update_one({"_id": email}, {"$set": updates})
    return {"status": "success"}

@app.post("/api/reward")
def claim_reward(data: RewardData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    user = db["users"].find_one({"_id": email})
    if not user: return {"status": "error", "message": "유저 없음"}
    if user.get("profile", {}).get("status") == "delisted":
        return {"status": "error", "message": "💀 상장폐지 상태에서는 보상을 받을 수 없습니다."}

    kst_now = datetime.utcnow() + timedelta(hours=9)
    server_today_str = kst_now.strftime("%Y-%m-%d")
    time_str = kst_now.strftime("%m.%d %H:%M")
    
    # 🔥 오늘의 이벤트 확인
    sys_data = db["system"].find_one({"_id": "global"}) or {}
    event_id = sys_data.get("daily_event_id", "none")

    msg = ""
    if data.reward_type == 'attendance':
        reward_amount = 150 if event_id == "bull" else 50  # 🐂 불장이면 150p!
        result = db["users"].update_one(
            {"_id": email, "$or": [{"profile.lastDailyAttendance": {"$ne": server_today_str}}, {"profile.lastDailyAttendance": {"$exists": False}}]},
            {"$inc": {"profile.price": reward_amount}, "$set": {"profile.lastDailyAttendance": server_today_str}}
        )
        if result.modified_count == 0: return {"status": "error", "message": "이미 완료하셨습니다!"}
        msg = f"📅 일일 출석 완료! (+{reward_amount}p)"
        update_mission_progress(email, "daily_attendance", 1)
        
    elif data.reward_type == 'double_attendance':
        reward_amount = 150 if event_id == "bull" else 50
        result = db["users"].update_one(
            {"_id": email, "profile.lastDailyAttendance": server_today_str, "$or": [{"profile.lastDailyAdBonus": {"$ne": server_today_str}}, {"profile.lastDailyAdBonus": {"$exists": False}}]},
            {"$inc": {"profile.price": reward_amount}, "$set": {"profile.lastDailyAdBonus": server_today_str}}
        )
        if result.modified_count == 0: return {"status": "error", "message": "이미 보상을 받았거나 출석을 먼저 해야 합니다."}
        msg = f"🎬 {reward_amount}p가 추가 상승했습니다."

    elif data.reward_type == 'extra_ticket':
        days_since_monday = kst_now.weekday()
        if kst_now.weekday() == 0 and kst_now.hour < 8: days_since_monday = 7
        recent_monday = (kst_now - timedelta(days=days_since_monday)).strftime("%Y-%m-%d")
        result = db["users"].update_one(
            {"_id": email, "$or": [{"profile.lastAdTicketMonday": {"$ne": recent_monday}}, {"profile.lastAdTicketMonday": {"$exists": False}}]},
            {"$inc": {"profile.goodTickets": 1, "profile.badTickets": 1}, "$set": {"profile.lastAdTicketMonday": recent_monday}}
        )
        if result.modified_count == 0: return {"status": "error", "message": "이번 주 광고 보상을 이미 받으셨습니다."}
        msg = "🎬 이번 주 추가 평가권 각 +1장 획득!"

    elif data.reward_type == 'weekly':
        result = db["users"].update_one(
            {"_id": email, "$or": [{"profile.weeklyTicketsClaimed": False}, {"profile.weeklyTicketsClaimed": {"$exists": False}}]},
            {"$inc": {"profile.goodTickets": 1, "profile.badTickets": 1}, "$set": {"profile.weeklyTicketsClaimed": True}}
        )
        if result.modified_count == 0: return {"status": "error", "message": "이미 완료하셨습니다!"}
        msg = "🎁 주간 보너스 평가권 획득!"
    else:
        return {"status": "error", "message": "알 수 없는 보상 타입입니다."}

    updated_user = db["users"].find_one({"_id": email})
    profile = updated_user["profile"]

    if data.reward_type in ['attendance', 'double_attendance']:
        if "priceHistory" not in profile: profile["priceHistory"] = [profile.get("basePrice", 20000)]; profile["timeHistory"] = ["시작"]
        profile["priceHistory"].append(profile["price"]); profile["timeHistory"].append(time_str)
        if profile["price"] > profile.get("maxPrice", 20000): profile["maxPrice"] = profile["price"]
        db["users"].update_one({"_id": email}, {"$set": {"profile.priceHistory": profile["priceHistory"], "profile.timeHistory": profile["timeHistory"], "profile.maxPrice": profile.get("maxPrice", 20000)}})

    return {"status": "success", "message": msg, "profile": hide_anonymous_evaluators(profile)}

@app.post("/api/evaluate")
def evaluate_user(data: EvalData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.evaluator_email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    data.evaluator_email = email
    data.target_email = data.target_email.strip().lower()
    if data.evaluator_email == data.target_email: return {"status": "error", "message": "자신을 평가할 수 없습니다."}
    
    # 1차 방어막: 3초 쿨타임
    if is_spamming(email, "evaluate", 3): return {"status": "error", "message": "요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요."}
    if data.intensity not in [1, 2, 3]: return {"status": "error", "message": "올바르지 않은 변동 수치입니다."}

    evaluator = db["users"].find_one({"_id": data.evaluator_email})
    target = db["users"].find_one({"_id": data.target_email})
    if not evaluator or not target: return {"status": "error", "message": "유저 정보 없음"}

    evaluator_name = evaluator.get("profile", {}).get("name", "익명")

    # 🔒 같은 투자 클럽(방)에 속한 친구만 평가할 수 있습니다.
    if not db["rooms"].find_one({"members": {"$all": [email, data.target_email]}}, {"_id": 1}):
        return {"status": "error", "message": "같은 투자 클럽에 있는 친구만 평가할 수 있습니다."}
    if data.eval_type not in ("good", "bad"): return {"status": "error", "message": "올바르지 않은 평가 종류입니다."}

    # 🔥 1. 익명권 원자적 차감 (따닥 방지)
    anon_used = False
    if data.is_anonymous and data.eval_type == 'bad':
        anon_update = db["users"].update_one(
            {"_id": data.evaluator_email, "profile.anonTickets": {"$gt": 0}},
            {"$inc": {"profile.anonTickets": -1}}
        )
        if anon_update.modified_count == 0: 
            return {"status": "error", "message": "보유한 익명 암살권이 없습니다."}
        evaluator_name = "익명(???)"
        anon_used = True

    sys_data = db["system"].find_one({"_id": "global"}) or {}
    event_id = sys_data.get("daily_event_id", "none")

    if data.eval_type == 'good':
        # 🔥 호평권 원자적 차감 (따닥으로 한 장에 두 번 평가하는 것 방지)
        good_update = db["users"].update_one(
            {"_id": data.evaluator_email, "profile.goodTickets": {"$gt": 0}},
            {"$inc": {"profile.goodTickets": -1, "profile.stats.goodGiven": 1}}
        )
        if good_update.modified_count == 0: return {"status": "error", "message": "호평권 부족"}

        # 👼 천사의 날이면 1.5배 곱하기!
        multiplier = 1.5 if event_id == "angel" else 1.0
        base_price = target["profile"].get("basePrice", 20000)
        change_amount = base_price * (data.intensity * 0.01) * multiplier
        kst_now = datetime.utcnow() + timedelta(hours=9)

        if "priceHistory" not in target["profile"]:
            db["users"].update_one({"_id": data.target_email, "profile.priceHistory": {"$exists": False}},
                                   {"$set": {"profile.priceHistory": [base_price], "profile.timeHistory": ["시작"]}})

        # 알림 메시지에도 소수점(1.5%)이 제대로 찍히도록 수정
        actual_pct = data.intensity * multiplier
        # 🔥 피평가자 주가도 원자적으로 올립니다 (여러 명이 동시에 평가해도 누락 없음)
        updated_target = db["users"].find_one_and_update(
            {"_id": data.target_email},
            {"$inc": {"profile.price": change_amount},
             "$push": {"noti": {"$each": [f"👍 [호평] {evaluator_name}님의 평가 (+{actual_pct}%): {data.reason}"], "$position": 0}}},
            return_document=ReturnDocument.AFTER
        )
        new_price = updated_target["profile"]["price"]
        db["users"].update_one(
            {"_id": data.target_email},
            {"$push": {"profile.priceHistory": new_price, "profile.timeHistory": kst_now.strftime("%m.%d %H:%M")},
             "$max": {"profile.maxPrice": new_price}}
        )
        send_push_notification(data.target_email, "👍 호평 도착!", f"{evaluator_name}님이 주가를 올려주셨습니다!")

        t_prof = updated_target["profile"]
        if t_prof.get("narackStartTime") and new_price > (max(t_prof.get("maxPrice", 20000), new_price) * 0.3):
            db["users"].update_one({"_id": data.target_email}, {"$set": {"profile.narackStartTime": None, "profile.narackLastHitEmail": None}})

        update_mission_progress(data.evaluator_email, "use_eval_tickets", 1)
        return {"status": "success", "message": "호평이 즉시 반영되었습니다."}

    else:
        # 🔥 3. 악평권 원자적 차감 (한 번만 차감합니다)
        bad_update = db["users"].update_one(
            {"_id": data.evaluator_email, "profile.badTickets": {"$gt": 0}},
            {"$inc": {"profile.badTickets": -1, "profile.stats.badGiven": 1}}
        )
        if bad_update.modified_count == 0:
            if anon_used:  # 악평권이 없으면 먼저 쓴 익명권은 돌려줍니다.
                db["users"].update_one({"_id": data.evaluator_email}, {"$inc": {"profile.anonTickets": 1}})
            return {"status": "error", "message": "악평권이 부족합니다!"}
        if anon_used: update_mission_progress(email, "use_anon_ticket", 1)

        # 🔥 무지개 반사(실드) 원자적 차감 → 성공하면 악평 무효
        shield_update = db["users"].update_one(
            {"_id": data.target_email, "profile.shieldCount": {"$gt": 0}},
            {"$inc": {"profile.shieldCount": -1}}
        )
        if shield_update.modified_count > 0:
            remaining = db["users"].find_one({"_id": data.target_email}, {"profile.shieldCount": 1})["profile"].get("shieldCount", 0)
            db["users"].update_one({"_id": data.target_email}, {"$push": {"noti": {"$each": [f"🛡️ [무지개 반사 방어 성공!] {evaluator_name}님이 나에게 악평(-{data.intensity}%)을 날렸지만, 방어권이 자동 사용되어 완벽하게 튕겨냈습니다! (남은 방어권: {remaining}개)"], "$position": 0}}})
            send_push_notification(data.target_email, "🛡️ 무지개 반사 발동!", f"{evaluator_name}님의 악평을 방어했습니다!")
            db["users"].update_one({"_id": data.evaluator_email}, {"$push": {"noti": {"$each": [f"💥 [공격 실패] {target['profile']['name']}님이 '무지개 반사'를 사용하여 악평이 무효화되었습니다!"], "$position": 0}}})
            update_mission_progress(data.evaluator_email, "use_eval_tickets", 1)
            return {"status": "success", "message": f"앗! 상대방이 '무지개 반사'를 사용하여 악평이 튕겨나갔습니다!"}

        # 악평 대기열 추가
        pending_item = {
            "id": str(uuid.uuid4()), 
            "evaluator_email": data.evaluator_email, 
            "evaluator_name": evaluator_name, 
            "intensity": data.intensity, 
            "reason": data.reason, 
            "timestamp": datetime.utcnow().isoformat() 
        }
        # $push로 추가만 해서, 같은 순간 바뀐 피평가자의 다른 데이터를 덮어쓰지 않습니다.
        db["users"].update_one({"_id": data.target_email}, {"$push": {"profile.pending_evals": pending_item}})
        send_push_notification(data.target_email, "🚨 악평 도착!", f"{evaluator_name}님이 악평을 날렸습니다. 재판을 열거나 수락하세요!")
        update_mission_progress(data.evaluator_email, "use_eval_tickets", 1)
        return {"status": "success", "message": "악평 전송 완료! 피평가자의 승인/이의제기를 대기합니다."}

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
        # 🔥 대기열에서 먼저 원자적으로 꺼냅니다 (따닥으로 두 번 승인되어 두 번 깎이는 것 방지)
        claim = db["users"].update_one({"_id": email, "profile.pending_evals.id": data.eval_id},
                                       {"$pull": {"profile.pending_evals": {"id": data.eval_id}}})
        if claim.modified_count == 0: return {"status": "error", "message": "이미 처리된 악평입니다."}

        base_price = profile.get("basePrice", 20000)
        change_amount = base_price * (target_eval["intensity"] * 0.01)
        if "priceHistory" not in profile:
            db["users"].update_one({"_id": email, "profile.priceHistory": {"$exists": False}},
                                   {"$set": {"profile.priceHistory": [base_price], "profile.timeHistory": ["시작"]}})
        updated = db["users"].find_one_and_update(
            {"_id": email},
            {"$inc": {"profile.price": -change_amount},
             "$push": {"noti": {"$each": [f"👎 [악평 수락] {target_eval['evaluator_name']}님의 악평(-{target_eval['intensity']}% 적용): {target_eval['reason']}"], "$position": 0}}},
            return_document=ReturnDocument.AFTER
        )
        new_price = updated["profile"]["price"]
        db["users"].update_one({"_id": email}, {"$push": {"profile.priceHistory": new_price, "profile.timeHistory": kst_now.strftime("%m.%d %H:%M")}})

        max_p = updated["profile"].get("maxPrice", 20000)
        if new_price <= (max_p * 0.3) and not updated["profile"].get("narackStartTime"):
            db["users"].update_one({"_id": email}, {"$set": {"profile.narackStartTime": datetime.utcnow().isoformat(), "profile.narackLastHitEmail": target_eval["evaluator_email"]}})
        return {"status": "success", "message": "악평을 승인하여 주가 변동이 최종 반영되었습니다."}

    elif data.action == "defend":
        cur_month = datetime.utcnow().strftime("%Y-%m")
        used = profile.get("defense_count", 0) if profile.get("defense_month") == cur_month else 0
        if used >= 3: return {"status": "error", "message": "이번 달 방어 재판권(3회)을 전부 소급 사용하셨습니다. 기각 불가."}

        is_anon = target_eval["evaluator_name"] == "익명(???)"
        common_room = db["rooms"].find_one({"members": {"$all": [email, target_eval["evaluator_email"]]}})
        if not common_room and not is_anon: return {"status": "error", "message": "공격한 유저와 같은 투자 클럽(방)에 소속되어 있지 않아 방어 재판을 개최할 수 없습니다."}
        target_room = common_room or db["rooms"].find_one({"members": email})
        if not target_room: return {"status": "error", "message": "재판을 열 투자 클럽(방)이 없습니다. 먼저 클럽에 참여해 주세요."}

        # 🔥 대기열 꺼내기 + 소송비 1,000p 차감 + 재판권 사용을 한 번에 처리 (따닥 시 두 번 결제/두 번 상정 방지)
        month_filter = {"profile.defense_month": cur_month} if profile.get("defense_month") == cur_month else {"profile.defense_month": {"$ne": cur_month}}
        count_update = {"$inc": {"profile.price": -1000, "profile.defense_count": 1}} if used > 0 else {"$inc": {"profile.price": -1000}, "$set": {"profile.defense_count": 1, "profile.defense_month": cur_month}}
        claim = db["users"].find_one_and_update(
            {"_id": email, "profile.pending_evals.id": data.eval_id, "profile.price": {"$gte": 1000}, **month_filter},
            {**count_update, "$pull": {"profile.pending_evals": {"id": data.eval_id}}},
            return_document=ReturnDocument.AFTER
        )
        if not claim:
            if profile.get("price", 20000) < 1000: return {"status": "error", "message": "계좌에 1,000p 이상이 있어야 재판을 발의할 수 있습니다."}
            return {"status": "error", "message": "이미 처리된 악평입니다."}

        new_price = claim["profile"]["price"]
        if "priceHistory" not in claim["profile"]:
            db["users"].update_one({"_id": email}, {"$set": {"profile.priceHistory": [profile.get("basePrice", 20000)], "profile.timeHistory": ["시작"]}})
        db["users"].update_one({"_id": email}, {"$push": {"profile.priceHistory": new_price, "profile.timeHistory": kst_now.strftime("%m.%d %H:%M")}})

        agenda = {
            "id": str(uuid.uuid4()), "creator_email": email, "target_email": email, "target_name": profile.get("name"),
            "type": "defense",
            "reason": f"[악평 이의제기 방어 재판] 피고인이 {target_eval['evaluator_name']}님의 악평(-{target_eval['intensity']}%)에 정식 탄핵 요청을 제기했습니다.\n[악평 사유]: {target_eval['reason']}",
            "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active",
            "associated_eval": target_eval, "deposit": 1000,
            "created_at": datetime.utcnow().isoformat() 
        }
        db["rooms"].update_one({"_id": target_room["_id"]}, {"$push": {"agendas": agenda}})
        update_mission_progress(email, "open_defense_trial", 1)
        return {"status": "success", "message": f"⚖️ 법정에 탄핵 상정! (소송 비용 1,000p 차감 / 남은 기회: {3 - claim['profile']['defense_count']}회)"}

    return {"status": "error", "message": "알 수 없는 요청입니다."}

@app.get("/api/check-nickname")
def check_nickname(nickname: str):
    # 🔥 보안 포인트: 닉네임 길이 제한 (2~8자)
    if len(nickname) < 2 or len(nickname) > 8:
        return {"available": False, "message": "닉네임은 2~8자 사이여야 합니다."}
    
    # 욕설 필터링 (간단한 예시 목록, 더 추가 가능)
    bad_words = ["욕설1", "욕설2", "비속어"] 
    if any(word in nickname for word in bad_words):
        return {"available": False, "message": "사용할 수 없는 단어가 포함되어 있습니다."}

    user = db["users"].find_one({"profile.name": nickname})
    if user: return {"available": False, "message": "이미 사용 중인 닉네임입니다."}
    return {"available": True}

@app.post("/api/room/create")
def create_room(data: RoomData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email: 
        return {"status": "error", "message": "인증 실패"}
        
    # 🔥 기존 data.creator_email 에서 data.email 로 올바르게 수정되었습니다!
    if email != data.email.strip().lower(): 
        return {"status": "error", "message": "인증 실패"}
        
    alphabet = string.ascii_letters + string.digits
    code = ''.join(secrets.choice(alphabet) for _ in range(8))
    
    db["rooms"].insert_one({
        "_id": code, 
        "name": data.room_name, 
        "members": [email], 
        "agendas": [], 
        "messages": [], 
        "events": []
    })
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
        if a.get("status") == "active" and a.get("target_email") == email: return {"status": "error", "message": "도망 금지: 진행 중인 재판이 있어 방을 나갈 수 없습니다."}
    for pe in profile.get("pending_evals", []):
        if pe.get("evaluator_email") in room_members: return {"status": "error", "message": "도망 금지: 대기 중인 악평이 있습니다."}
    if profile.get("narackStartTime") and profile.get("narackLastHitEmail") in room_members: return {"status": "error", "message": "도망 금지: 상장폐지 심사 대기 중입니다."}
    db["rooms"].update_one({"_id": data.room_code}, {"$pull": {"members": email}})
    return {"status": "success"}

@app.post("/api/room/chat")
def send_chat(data: dict, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.get("sender_email"):
        return {"status": "error", "message": "인증 실패"}

    room_code = data.get("room_code")
    if not isinstance(room_code, str): return {"status": "error", "message": "잘못된 요청입니다."}
    message_text = str(data.get("message", "")).strip()
    is_megaphone = data.get("is_megaphone", False) is True

    if not message_text:
        return {"status": "error", "message": "메시지가 비어있습니다."}
    if len(message_text) > 500:
        return {"status": "error", "message": "메시지는 500자까지 보낼 수 있습니다."}
    if is_spamming(email, "chat", 1): return {"status": "error", "message": "메시지를 너무 빨리 보내고 있어요."}

    # 🔒 해당 클럽 멤버만 채팅할 수 있습니다.
    room = db["rooms"].find_one({"_id": room_code}, {"members": 1})
    if not room or email not in room.get("members", []):
        return {"status": "error", "message": "클럽 멤버가 아닙니다."}

    user = db["users"].find_one({"_id": email})
    if not user: return {"status": "error"}

    profile = user.get("profile", {})
    
    # 확성기 사용 시 티켓 원자적 차감 (따닥 방지)
    if is_megaphone:
        mega_update = db["users"].update_one({"_id": email, "profile.clubMegaphones": {"$gt": 0}}, {"$inc": {"profile.clubMegaphones": -1}})
        if mega_update.modified_count == 0:
            return {"status": "error", "message": "확성기 티켓이 부족합니다."}
        update_mission_progress(email, "use_megaphone", 1)

    # 저장할 메시지 객체 생성 (안전하게 문자열 시간으로 저장)
    new_message = {
        "sender_email": email,
        "sender_name": profile.get("name", "익명"),  # 🔒 이름은 화면이 보낸 값이 아니라 DB 값을 씁니다 (사칭 방지)
        "message": message_text,
        "is_megaphone": is_megaphone, 
        "timestamp": datetime.utcnow().isoformat() 
    }

    # 🔥 오류 원인 수정: "room_code"가 아니라 "_id"로 방을 찾아 업데이트해야 합니다!
    db["rooms"].update_one(
        {"_id": room_code}, 
        {"$push": {"messages": {"$each": [new_message], "$slice": -MAX_ROOM_MESSAGES}}}
    )
    return {"status": "success"}

@app.post("/api/room/event/add")
def add_room_event(data: EventAddData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.creator_email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "권한 없음"}
    event = { "id": str(uuid.uuid4()), "start_date": data.start_date, "end_date": data.end_date, "title": data.title, "creator_email": email, "creator_name": (db["users"].find_one({"_id": email}, {"profile.name": 1}) or {}).get("profile", {}).get("name", "익명") }
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"events": event}})
    return {"status": "success"}

@app.post("/api/room/event/delete")
def delete_room_event(data: EventDeleteData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.deleter_email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "권한 없음"}
    db["rooms"].update_one({"_id": data.room_code}, {"$pull": {"events": {"id": data.event_id}}})
    return {"status": "success"}

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
            "reason": f"[클럽 내보내기 투표] {profile.get('name')}님이 {target_name}님을 내보내자고 건의했습니다.\n[사유]: {data.reason}",
            "agreeVotes": 0, "disagreeVotes": 0, "votedUsers": [], "status": "active",
            "deposit": 0,
            "created_at": datetime.utcnow().isoformat()
        }
        db["rooms"].update_one({"_id": data.room_code}, {"$push": {"agendas": agenda}})
        return {"status": "success", "message": "내보내기 투표가 시작되었습니다!"}
        
    return {"status": "error", "message": "잘못된 안건 타입입니다."}

@app.post("/api/agenda/vote")
def vote_agenda(data: VoteData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.voter_email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    if data.vote_type not in ("agree", "disagree"): return {"status": "error", "message": "올바르지 않은 투표입니다."}

    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "방이 없거나 해당 클럽의 멤버가 아닙니다."}

    # 🔥 진행 중(active)이고 아직 투표 안 한 안건에만, 원자적으로 한 표를 더합니다.
    #    (이미 끝난 재판에 투표해 판결이 반복되거나, 동시 투표로 표가 사라지는 문제 방지)
    vote_field = "agendas.$.agreeVotes" if data.vote_type == "agree" else "agendas.$.disagreeVotes"
    vote_res = db["rooms"].update_one(
        {"_id": data.room_code, "agendas": {"$elemMatch": {"id": data.agenda_id, "status": "active", "votedUsers": {"$ne": email}}}},
        {"$push": {"agendas.$.votedUsers": email}, "$inc": {vote_field: 1}}
    )
    if vote_res.modified_count == 0:
        a = next((x for x in room.get("agendas", []) if x.get("id") == data.agenda_id), None)
        if not a: return {"status": "error", "message": "안건을 찾을 수 없습니다."}
        if email in a.get("votedUsers", []): return {"status": "error", "message": "이미 투표하셨습니다."}
        return {"status": "error", "message": "이미 종료된 안건입니다."}
    update_mission_progress(email, "participate_vote", 1)

    room = db["rooms"].find_one({"_id": data.room_code})
    target_agenda = next((x for x in room.get("agendas", []) if x.get("id") == data.agenda_id), None)
    if not target_agenda: return {"status": "success", "message": "투표 완료"}

    total_members = len(room.get("members", []))
    required_votes = (total_members // 2) + 1
    status_msg = "success"; message = "투표 완료"
    kst_now = datetime.utcnow() + timedelta(hours=9)

    def close_agenda(new_status: str) -> bool:
        """active → 종료 상태로 딱 한 번만 바꿉니다. 바꾼 요청만 판결을 집행합니다."""
        res = db["rooms"].update_one(
            {"_id": data.room_code, "agendas": {"$elemMatch": {"id": data.agenda_id, "status": "active"}}},
            {"$set": {"agendas.$.status": new_status}}
        )
        return res.modified_count == 1

    if target_agenda["agreeVotes"] >= required_votes:
        if not close_agenda("resolved"): return {"status": "success", "message": "투표 완료"}
        target_user = db["users"].find_one({"_id": target_agenda["target_email"]})
        
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
                
            message = f"과반수 찬성으로 {target_agenda['target_name']}님이 클럽에서 나갔습니다."

        elif target_user:
            if target_agenda["type"] == "delist":
                target_user["profile"]["status"] = "delisted"; target_user["profile"]["price"] = 0
                message = f"{target_agenda['target_name']}님이 자동/수동 판결에 의해 최종 상장폐지되었습니다."
            elif target_agenda["type"] == "revival":
                target_user["profile"]["status"] = "active"; target_user["profile"]["price"] = 10000
                message = f"{target_agenda['target_name']}님이 기적적으로 회생(재상장) 되었습니다!"
            elif target_agenda["type"] == "defense":
                apply_defense_loss(target_agenda, target_user, kst_now)
                message = f"[재판 패소] 배심원단이 악평을 정당하다고 판결했습니다! {target_agenda['target_name']}님의 주가가 하락합니다."

            db["users"].update_one({"_id": target_agenda["target_email"]}, {"$set": {"profile": target_user["profile"], "noti": target_user.get("noti", [])}})
        status_msg = "resolved"

    elif target_agenda["disagreeVotes"] >= required_votes:
        if not close_agenda("rejected"): return {"status": "success", "message": "투표 완료"}
        status_msg = "resolved"
        if target_agenda["type"] == "kick":
            target_user = db["users"].find_one({"_id": target_agenda["target_email"]})
            if target_user:
                t_noti = target_user.get("noti", [])
                t_noti.insert(0, f"🚪 [내보내기 부결] 나를 내보내려던 투표가 부결되었습니다.")
                db["users"].update_one({"_id": target_agenda["target_email"]}, {"$set": {"noti": t_noti}})
            message = f"반대표가 많아 내보내기 안건이 기각되었습니다."
            
        elif target_agenda["type"] == "defense":
            message = f"[재판 승소] 배심원단이 기각하여 {target_agenda['target_name']}님이 방어에 성공했습니다! 악평은 무효 소멸됩니다."
            target_user = db["users"].find_one({"_id": target_agenda["target_email"]})
            if target_user:
                t_prof = target_user.get("profile", {})
                t_prof["price"] = t_prof.get("price", 20000) + 1100
                if "priceHistory" not in t_prof: t_prof["priceHistory"] = [t_prof.get("basePrice", 20000)]; t_prof["timeHistory"] = ["시작"]
                t_prof["priceHistory"].append(t_prof["price"])
                t_prof["timeHistory"].append(kst_now.strftime("%m.%d %H:%M"))
                t_noti = target_user.get("noti", [])
                t_noti.insert(0, f"🎉 [재판 승소] 방어에 성공하여 소송 비용 환급 및 승소 위자료를 포함해 총 1,100p를 지급받았습니다!")
                db["users"].update_one({"_id": target_agenda["target_email"]}, {"$set": {"profile": t_prof, "noti": t_noti}})
        else:
            message = f"반대표가 많아 안건이 최종 기각되었습니다."

    return {"status": status_msg, "message": message}

# 상품별로 프로필에서 늘려줄 필드
ITEM_FIELDS = {
    "nickname_color_ticket": ("nickname_color_tickets", "🎨 닉네임 컬러 변경권"),
    "club_megaphone": ("clubMegaphones", "📢 클럽 확성기"),
    "shield_ticket": ("shieldCount", "🌈 무지개 반사 방어권"),
    "anon_ticket": ("anonTickets", "👻 익명 암살권"),
}

def set_global_megaphone(profile: dict, text) -> None:
    text = str(text or "").strip()[:100]
    db["system"].update_one(
        {"_id": "global"},
        {"$set": {"megaphone": f"[{profile.get('name', '익명')}] {text}", "megaphone_time": datetime.utcnow().isoformat()}},
        upsert=True
    )

@app.post("/api/shop/buy")
def buy_shop_item(data: dict, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.get("email"): return {"status": "error", "message": "인증 실패"}

    item_type = data.get("item_type")
    extra_data = data.get("extra_data", "")
    if not isinstance(item_type, str): return {"status": "error", "message": "잘못된 요청입니다."}

    # 🔥 중앙 관리되는 가격표에서 포인트 가격을 가져옵니다.
    if item_type not in SHOP_PRICES or "point" not in SHOP_PRICES[item_type]:
        return {"status": "error", "message": "알 수 없는 상품이거나 포인트로 구매할 수 없습니다."}
    if item_type == "megaphone" and not str(extra_data or "").strip():
        return {"status": "error", "message": "확성기 메시지를 입력해 주세요."}

    cost = SHOP_PRICES[item_type]["point"]
    inc = {"profile.price": -cost}
    if item_type in ITEM_FIELDS: inc[f"profile.{ITEM_FIELDS[item_type][0]}"] = 1

    # 🔥 잔고 확인 + 차감 + 지급을 한 번에 (따닥으로 한 번 값에 두 개 받는 것 방지)
    updated = db["users"].find_one_and_update(
        {"_id": email, "profile.price": {"$gte": cost}},
        {"$inc": inc},
        return_document=ReturnDocument.AFTER
    )
    if not updated:
        return {"status": "error", "message": "잔고가 부족합니다."}

    profile = updated["profile"]
    if item_type == "megaphone":
        set_global_megaphone(profile, extra_data)
        message = "📢 글로벌 확성기 메시지가 전국구 전광판에 등록되었습니다!"
    else:
        message = f"{ITEM_FIELDS[item_type][1]}을(를) 획득했습니다!"

    update_mission_progress(email, "buy_shop_item", 1)
    return {"status": "success", "message": message, "profile": hide_anonymous_evaluators(profile)}

# 🔒 실제 결제 검증이 아직 없어서, 켜두면 누구나 API로 유료 아이템을 무한히 받을 수 있습니다.
#    친구들끼리 테스트할 때만 Render 환경 변수에 CASH_SHOP_FREE_TEST=true 를 넣어 켜세요.
CASH_SHOP_FREE_TEST = os.getenv("CASH_SHOP_FREE_TEST", "").lower() == "true"
THEME_ITEMS = {"theme_neon": ("neon", "✨ 홀로그램 네온 테마"), "theme_fire": ("fire", "🔥 지옥의 불꽃 테마")}

@app.post("/api/cash-shop/buy")
def buy_cash_item(data: dict, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.get("email"): return {"status": "error", "message": "인증 실패"}
    if not CASH_SHOP_FREE_TEST:
        return {"status": "error", "message": "💳 캐시 상점은 결제 시스템 준비 중입니다. 조금만 기다려 주세요!"}

    item_type = data.get("item_type")
    extra_data = data.get("extra_data", "")
    if not isinstance(item_type, str): return {"status": "error", "message": "잘못된 요청입니다."}

    if item_type in ITEM_FIELDS:
        update = {"$inc": {f"profile.{ITEM_FIELDS[item_type][0]}": 1}}
        message = f"{ITEM_FIELDS[item_type][1]}을(를) 구매했습니다!"
    elif item_type == "fund_pack":
        update = {"$inc": {"profile.price": 10000}}
        message = "💰 긴급 자금 10,000p가 수혈되었습니다!"
    elif item_type in THEME_ITEMS:
        update = {"$addToSet": {"profile.ownedThemes": THEME_ITEMS[item_type][0]}}
        message = f"{THEME_ITEMS[item_type][1]}를 획득했습니다!"
    elif item_type == "megaphone":
        if not str(extra_data or "").strip(): return {"status": "error", "message": "확성기 메시지를 입력해 주세요."}
        update = None
        message = "📢 글로벌 확성기 메시지가 전국구 전광판에 등록되었습니다!"
    else:
        return {"status": "error", "message": "알 수 없는 유료 상품입니다."}

    if update: db["users"].update_one({"_id": email}, update)
    user = db["users"].find_one({"_id": email})
    if not user: return {"status": "error", "message": "유저 없음"}
    profile = user.get("profile", {})
    if item_type == "megaphone": set_global_megaphone(profile, extra_data)

    update_mission_progress(email, "buy_shop_item", 1)
    return {"status": "success", "message": message, "profile": hide_anonymous_evaluators(profile)}

@app.post("/api/room/gamble")
def room_gamble(data: GambleData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email.strip().lower(): return {"status": "error", "message": "인증 실패"}
    if is_spamming(email, "gamble", 2): return {"status": "error", "message": "천천히 배팅해주세요."}

    user = db["users"].find_one({"_id": email})
    if not user or user["profile"].get("price", 0) < 500: return {"status": "error", "message": "도박장 입장 최소 금액(500p)이 부족합니다."}

    room = db["rooms"].find_one({"_id": data.room_code})
    if not room or email not in room.get("members", []): return {"status": "error", "message": "클럽 멤버가 아닙니다."}

    if data.guess not in ("홀", "짝"): return {"status": "error", "message": "'홀' 또는 '짝'에 배팅해 주세요."}
    dice = random.randint(1, 6)
    is_odd = dice % 2 != 0
    win = is_odd == (data.guess == "홀")
    result_str = "홀" if is_odd else "짝"

    kst_now = datetime.utcnow() + timedelta(hours=9)
    time_str = kst_now.strftime("%m.%d %H:%M")

    # 🔥 잔고 확인과 증감을 한 번에 (동시 배팅으로 잔고가 꼬이는 것 방지)
    updated = db["users"].find_one_and_update(
        {"_id": email, "profile.price": {"$gte": 500}},
        {"$inc": {"profile.price": 500 if win else -500}},
        return_document=ReturnDocument.AFTER
    )
    if not updated: return {"status": "error", "message": "도박장 입장 최소 금액(500p)이 부족합니다."}
    profile = updated["profile"]

    if win:
        chat_msg = f"🎲 [도박장] {profile.get('name')}님이 '{data.guess}'에 배팅! ➔ 주사위 {dice} ({result_str}) ➔ 💰 500p 획득!"
        msg = f"🎲 주사위 {dice} ({result_str})! 승리! 💰 500p를 획득하셨습니다!"
        update_mission_progress(email, "win_gamble", 1)
    else:
        chat_msg = f"🎲 [도박장] {profile.get('name')}님이 '{data.guess}'에 배팅! ➔ 주사위 {dice} ({result_str}) ➔ 💸 500p 증발..."
        msg = f"🎲 주사위 {dice} ({result_str})... 도박 실패. 💸 500p를 잃으셨습니다."

    if "priceHistory" not in profile:
        db["users"].update_one({"_id": email}, {"$set": {"profile.priceHistory": [profile.get("basePrice", 20000)], "profile.timeHistory": ["시작"]}})
    db["users"].update_one({"_id": email}, {"$push": {"profile.priceHistory": profile["price"], "profile.timeHistory": time_str}})
    db["rooms"].update_one({"_id": data.room_code}, {"$push": {"messages": {"$each": [{"sender_email": "system", "sender_name": "시스템", "message": chat_msg, "timestamp": datetime.utcnow().isoformat()}], "$slice": -MAX_ROOM_MESSAGES}}})

    return {"status": "success", "message": msg}

@app.post("/api/upload")
async def upload_image(image: UploadFile = File(...), authorization: str = Header(None)):
    # 🔒 로그인한 유저만 업로드 가능 (아무나 ImgBB 키를 쓰는 것 방지)
    if not verify_google_token(authorization): raise HTTPException(status_code=401, detail="인증 실패")
    if not image.content_type or not image.content_type.startswith("image/"): raise HTTPException(status_code=400, detail="이미지 파일만 업로드할 수 있습니다.")
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

ALLOWED_PUSH_HOSTS = ("fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com", "push.microsoft.com")

@app.post("/api/push/subscribe")
def subscribe_push(data: PushSubscriptionData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email: return {"status": "error", "message": "인증 실패"}

    # 🔒 브라우저 공식 푸시 서버 주소만 허용 (서버가 공격자가 정한 주소로 요청을 보내는 SSRF 방지)
    host = urlparse(data.endpoint).hostname or ""
    if not data.endpoint.startswith("https://") or not any(host == d or host.endswith("." + d) for d in ALLOWED_PUSH_HOSTS):
        return {"status": "error", "message": "지원하지 않는 푸시 주소입니다."}

    # 유저 DB에 스마트폰 푸시 알림 주소(subscription) 저장
    db["users"].update_one(
        {"_id": email},
        {"$set": {"push_subscription": data.dict()}}
    )
    return {"status": "success"}

# 기존 스키마들이 모여있는 곳(파일 위쪽)에 아래 클래스를 추가해 주세요.
class TitleData(BaseModel):
    title: str

# 파일 아래쪽 API 모음 쪽에 아래 함수를 추가해 주세요.
@app.post("/api/title/equip")
def equip_title(data: TitleData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email: 
        return {"status": "error", "message": "인증 실패"}

    user = db["users"].find_one({"_id": email})
    if not user: 
        return {"status": "error", "message": "유저 정보 없음"}
        
    profile = user.get("profile", {})
    
    # 지금은 테스트를 위해 기본 칭호 3개를 줍니다. (나중에 업적 달성 시 추가하는 로직을 만들면 됩니다)
    owned_titles = profile.get("titles", ["초보 투자자", "눈팅족", "주린이"])
    
    # 칭호를 해제(빈 문자열 "")하거나, 내가 보유한 칭호일 때만 저장 허용
    if data.title != "" and data.title not in owned_titles:
        return {"status": "error", "message": "보유하지 않은 칭호입니다."}

    # DB에 장착한 칭호 업데이트
    db["users"].update_one(
        {"_id": email}, 
        {"$set": {"profile.equippedTitle": data.title, "profile.titles": owned_titles}}
    )
    
    return {"status": "success", "message": "칭호가 멋지게 장착되었습니다!"}

# --- [신규 추가] 닉네임 컬러 변경 API ---
class ColorChangeData(BaseModel):
    email: str
    color: str

@app.post("/api/profile/change-color")
def change_nickname_color(data: ColorChangeData, authorization: str = Header(None)):
    email = verify_google_token(authorization)
    if not email or email != data.email: 
        return {"status": "error", "message": "인증 실패"}

    user = db["users"].find_one({"_id": email})
    if not user: 
        return {"status": "error", "message": "유저 정보 없음"}

    # 🔒 #RRGGBB 형식만 허용 (색 대신 스크립트를 넣는 공격 방지)
    if not is_valid_hex_color(data.color):
        return {"status": "error", "message": "올바르지 않은 색상 값입니다."}

    # 티켓 1장 원자적 차감 및 새로운 색상 저장
    updated = db["users"].find_one_and_update(
        {"_id": email, "profile.nickname_color_tickets": {"$gt": 0}},
        {"$inc": {"profile.nickname_color_tickets": -1}, "$set": {"profile.nameColor": data.color}},
        return_document=ReturnDocument.AFTER
    )
    if not updated:
        return {"status": "error", "message": "보유한 닉네임 컬러 변경권이 없습니다."}
    return {"status": "success", "message": "닉네임 색상이 화려하게 변경되었습니다!", "profile": hide_anonymous_evaluators(updated["profile"])}
