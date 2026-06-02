// ★ 주의: 본인의 Codespaces 8000번 포트 주소를 꼭 다시 넣어주세요!
const BACKEND_URL = "https://friend-coin.onrender.com";

let myUsername = localStorage.getItem('fc_username') || null;

function getCurrentTime() {
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const defaultTime = getCurrentTime();

const defaultFriends = [
    { id: 1, name: "서민수", profileImage: "", emoji: "🍔", price: 20000, basePrice: 20000, maxPrice: 20000, status: 'active', badges: [], history: [{price: 20000, time: defaultTime}] },
    { id: 2, name: "김태윤", profileImage: "", emoji: "🎮", price: 20000, basePrice: 20000, maxPrice: 20000, status: 'active', badges: [], history: [{price: 20000, time: defaultTime}] },
    { id: 3, name: "임서준", profileImage: "", emoji: "📚", price: 20000, basePrice: 20000, maxPrice: 20000, status: 'active', badges: [], history: [{price: 20000, time: defaultTime}] },
    { id: 4, name: "박지우", profileImage: "", emoji: "⚽", price: 20000, basePrice: 20000, maxPrice: 20000, status: 'active', badges: [], history: [{price: 20000, time: defaultTime}] }
];

const defaultProfile = { 
    name: "Guest", profileImage: "", emoji: "👨‍💻", price: 20000, basePrice: 20000, maxPrice: 20000, status: 'active',
    goodTickets: 2, badTickets: 2, lastRefillTime: null, lastDailyAttendance: null, weeklyTicketsClaimed: false,
    lastDailyAdBonus: null, dailyAdTicketsDate: null, dailyAdTicketsCount: 0, 
    badges: [], stats: { goodGiven: 0, badGiven: 0, trialCount: 0 },
    isVIP: false, nameColor: "#333d4b" 
};

let friendsData = []; 
let meetingAgendas = [];
let myProfile = null; // 로그인 전에는 비워둠
let myNotifications = [];

// ★ 내 이름표를 달고 서버에 데이터 요청!
async function fetchFriendsData() {
    if (!myUsername) return; 
    try {
        const response = await fetch(`${BACKEND_URL}/api/data/${encodeURIComponent(myUsername)}`);
        if (!response.ok) throw new Error("서버 응답 오류");
        
        const serverData = await response.json();
        
        friendsData = serverData.friends || defaultFriends;
        meetingAgendas = serverData.agendas || [];
        myProfile = serverData.profile || defaultProfile; // 에러 방지용 기본값
        myNotifications = serverData.noti || [];
        
        console.log(`🚀 ${myUsername}님의 데이터 로딩 성공!`, serverData);
    } catch (error) {
        console.error("🚨 서버 연결 실패.", error);
        friendsData = JSON.parse(localStorage.getItem('fc_friends')) || defaultFriends;
        meetingAgendas = JSON.parse(localStorage.getItem('fc_agendas')) || [];
        myProfile = JSON.parse(localStorage.getItem('fc_profile')) || defaultProfile;
        myNotifications = JSON.parse(localStorage.getItem('fc_noti')) || [];
    }
}

function saveData() {
    if (!myUsername) return;
    localStorage.setItem('fc_friends', JSON.stringify(friendsData));
    localStorage.setItem('fc_agendas', JSON.stringify(meetingAgendas));
    localStorage.setItem('fc_profile', JSON.stringify(myProfile));
    localStorage.setItem('fc_noti', JSON.stringify(myNotifications));

    const payload = {
        friends: friendsData,
        agendas: meetingAgendas,
        profile: myProfile,
        noti: myNotifications
    };

    fetch(`${BACKEND_URL}/api/save/${encodeURIComponent(myUsername)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => console.log("✅ DB 저장 완료:", data))
    .catch(err => console.error("🚨 DB 저장 실패:", err));
}

function resetData() {
    localStorage.clear();
    location.reload();
}