const BACKEND_URL = "https://effective-space-journey-xjqp4x6v4jv3vvv4-8000.app.github.dev";

let myEmail = localStorage.getItem('fc_email') || null; 
let myUsername = localStorage.getItem('fc_username') || null;
let loginIntent = ''; 

function getCurrentTime() {
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const defaultProfile = { 
    name: "", profileImage: "", emoji: "👨‍💻", price: 20000, basePrice: 20000, maxPrice: 20000, status: 'active',
    goodTickets: 2, badTickets: 2, lastRefillTime: null, lastDailyAttendance: null, weeklyTicketsClaimed: false,
    lastDailyAdBonus: null, dailyAdTicketsDate: null, dailyAdTicketsCount: 0, 
    badges: [], stats: { goodGiven: 0, badGiven: 0, trialCount: 0 },
    isVIP: false, nameColor: "#333d4b" 
};

let myProfile = null; 
let myNotifications = [];
let myRooms = [];         
let globalRanking = [];   
let currentRoomCode = null; 
let currentAdRewardType = null;
let adInterval = null;

const DEFAULT_AVATARS = [
    'https://api.dicebear.com/7.x/bottts/svg?seed=Felix&backgroundColor=b6e3f4', 'https://api.dicebear.com/7.x/bottts/svg?seed=Aneka&backgroundColor=c0aede',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Oliver&backgroundColor=ffd5dc', 'https://api.dicebear.com/7.x/bottts/svg?seed=Sophie&backgroundColor=d1d4f9',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Jack&backgroundColor=ffdfbf', 'https://api.dicebear.com/7.x/bottts/svg?seed=Mia&backgroundColor=b6e3f4',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Leo&backgroundColor=c0aede', 'https://api.dicebear.com/7.x/bottts/svg?seed=Chloe&backgroundColor=ffd5dc',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Sam&backgroundColor=d1d4f9', 'https://api.dicebear.com/7.x/bottts/svg?seed=Zoe&backgroundColor=ffdfbf'
];

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg; toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

function getAvatarHtml(person, size = 'small') {
    const sizePx = size === 'large' ? '100px' : '40px'; const radius = size === 'large' ? '24px' : '14px'; 
    const isDelisted = person.status === 'delisted'; const filter = isDelisted ? 'grayscale(100%) opacity(50%)' : 'none';
    if (person.profileImage) return `<img src="${person.profileImage}" style="width:${sizePx}; height:${sizePx}; border-radius:${radius}; object-fit:cover; display:inline-block; vertical-align:middle; background:#f2f4f6; box-shadow: 0 2px 8px rgba(0,0,0,0.1); filter:${filter};">`;
    else return `<span style="display:inline-block; width:${sizePx}; height:${sizePx}; line-height:${sizePx}; text-align:center; font-size:${size === 'large' ? '50px' : '20px'}; background:#f9fafb; border-radius:${radius}; vertical-align:middle; box-shadow: 0 2px 8px rgba(0,0,0,0.05); filter:${filter};">${isDelisted ? '💀' : person.emoji || '👤'}</span>`;
}

function getBadgeHtml(person) {
    let allBadges = [...(person.dynamicBadges || []), ...(person.badges || [])];
    if (allBadges.length === 0) return '';
    return `<div style="display:flex; gap:4px; margin-top:4px; flex-wrap:wrap;">` + allBadges.map(b => `<span style="font-size:10px; background:#f2f4f6; padding:2px 6px; border-radius:4px; color:#4e5968;">${b}</span>`).join('') + `</div>`;
}

function renderNoti() {
    const container = document.getElementById('noti-list');
    if (!container) return;
    if (!myNotifications || myNotifications.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:#8b95a1;">새로운 알림이 없습니다.</div>';
        return;
    }
    container.innerHTML = myNotifications.map(n => `<div style="padding:15px; border-bottom:1px solid #f2f4f6; color:#333d4b;">${n}</div>`).join('');
}

function checkBadges() {
    if (!myProfile || !myProfile.badges) return;
    if (myProfile.stats.goodGiven >= 2 && !myProfile.badges.includes('👼천사')) { myProfile.badges.push('👼천사'); showToast('🎉 [칭호 획득] 👼천사'); }
    if (myProfile.stats.badGiven >= 2 && !myProfile.badges.includes('😈악마')) { myProfile.badges.push('😈악마'); showToast('🎉 [칭호 획득] 😈악마'); }
    if (myProfile.stats.trialCount >= 2 && !myProfile.badges.includes('⚖️법정단골')) { myProfile.badges.push('⚖️법정단골'); showToast('🎉 [칭호 획득] ⚖️법정단골'); }

    if (globalRanking.length === 0) return;
    const top1 = globalRanking[0];
    const topGainer = [...globalRanking].sort((a,b) => ((b.price||0) - (b.basePrice||0)) - ((a.price||0) - (a.basePrice||0)))[0];
    
    globalRanking.forEach(p => {
        p.dynamicBadges = []; 
        if (p.isVIP) p.dynamicBadges.push('👑VIP');
        if (top1 && p.name === top1.name) p.dynamicBadges.push('👑1위');
        if (topGainer && p.name === topGainer.name && (p.price - p.basePrice) > 0) p.dynamicBadges.push('🚀떡상왕');
    });
}

function updateTicker() {
    const tickerEl = document.getElementById('ticker-text'); let newsItems = [];
    if(!myProfile || globalRanking.length === 0) return; 
    
    newsItems.push(`[글로벌 시황] 👑 전국 1위: ${globalRanking[0].name} (${Math.floor(globalRanking[0].price||0).toLocaleString()}p)`);
    newsItems.push(`[공지] 프라이빗 단톡방 시스템이 새롭게 업데이트 되었습니다!`);
    
    tickerEl.innerHTML = newsItems.join(' &nbsp;&nbsp;&nbsp;&nbsp; | &nbsp;&nbsp;&nbsp;&nbsp; ');
}

function saveData() { 
    checkBadges(); updateTicker(); 
    if (!myEmail) return;
    const payload = { profile: myProfile, noti: myNotifications };
    fetch(`${BACKEND_URL}/api/save/${encodeURIComponent(myEmail)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    }).catch(err => console.error("🚨 DB 저장 실패:", err));
}

function checkRefill() {
    if(!myProfile) return;
    const now = new Date(); const day = now.getDay(); 
    let daysToSubtract = day - 1; if (daysToSubtract < 0) daysToSubtract = 6; if (day === 1 && now.getHours() < 8) daysToSubtract = 7; 
    const recentMonday8AM = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToSubtract, 8, 0, 0, 0).getTime();
    
    if (myProfile.weeklyTicketsClaimed === undefined) {
        myProfile.goodTickets = 2; myProfile.badTickets = 2; myProfile.weeklyTicketsClaimed = false; myProfile.lastDailyAttendance = null; myProfile.lastRefillTime = Date.now(); saveData();
    } else if (!myProfile.lastRefillTime || myProfile.lastRefillTime < recentMonday8AM) {
        myProfile.goodTickets = 2; myProfile.badTickets = 2; myProfile.weeklyTicketsClaimed = false; myProfile.lastRefillTime = Date.now(); showToast("🔄 새로운 한 주! 평가권이 리필되었습니다."); saveData();
    }
}

function switchTab(tabName) {
    if(!myProfile) return;
    checkRefill(); checkBadges();
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('view-active', 'view-hidden-right', 'view-hidden-left'); });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const targetView = document.getElementById(tabName + '-view');
    if (targetView) targetView.classList.add('view-active');
    
    const tabIndex = { 'home': 0, 'meeting': 1, 'ranking': 2, 'noti': 3, 'profile': 4 }[tabName];
    const navItems = document.querySelectorAll('.nav-item');
    if (navItems[tabIndex]) navItems[tabIndex].classList.add('active');
    
    if (tabName === 'home') renderHome();
    if (tabName === 'meeting') renderMeeting();
    if (tabName === 'ranking') renderRanking();
    if (tabName === 'noti') renderNoti();
    if (tabName === 'profile') renderProfile();
}

// ==========================================
// ★ 단톡방 로비 & 내부 화면
// ==========================================
function renderHome() {
    const list = document.getElementById('friend-list');
    
    if (!currentRoomCode) { // 로비
        let html = `
            <div style="display:flex; gap:10px; margin-bottom:20px;">
                <button onclick="createNewRoom()" style="flex:1; padding:15px; background:#333d4b; color:white; border-radius:12px; font-weight:bold; border:none; cursor:pointer; box-shadow:0 4px 6px rgba(0,0,0,0.1);">+ 새 방 만들기</button>
                <button onclick="joinExistingRoom()" style="flex:1; padding:15px; background:#e8f5e9; color:#2e7d32; border-radius:12px; font-weight:bold; border:none; cursor:pointer; box-shadow:0 4px 6px rgba(0,0,0,0.05);">🔑 코드로 입장</button>
            </div>
            <h3 style="color:#333d4b; margin-top:0; font-size:16px;">내 단톡방 목록</h3>
        `;

        if (myRooms.length === 0) {
            html += `<div style="text-align:center; padding:50px 20px; color:#8b95a1; background:#f9fafb; border-radius:16px;">아직 참여 중인 방이 없습니다.<br>방을 만들거나 초대 코드로 입장해보세요!</div>`;
        } else {
            html += myRooms.map(r => `
                <div onclick="enterRoom('${r.room_code}')" class="info-card" style="cursor:pointer; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; border:2px solid transparent; transition:0.2s;" onmouseover="this.style.borderColor='#3182f6'" onmouseout="this.style.borderColor='transparent'">
                    <div>
                        <div style="font-weight:bold; font-size:16px; color:#333d4b; margin-bottom:4px;">${r.room_name}</div>
                        <div style="font-size:12px; color:#8b95a1;">👥 참여 인원: ${r.members.length}명 | 🔑 코드: <span style="color:#3182f6; font-weight:bold;">${r.room_code}</span></div>
                    </div>
                    <div style="color:#3182f6; font-size:20px;">👉</div>
                </div>
            `).join('');
        }
        list.innerHTML = html;
    } 
    else { // 방 내부
        const room = myRooms.find(r => r.room_code === currentRoomCode);
        if (!room) { currentRoomCode = null; renderHome(); return; }

        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; background:#f2f4f6; padding:15px; border-radius:16px;">
                <button onclick="exitRoomView()" style="background:white; border:1px solid #e5e8eb; padding:8px 12px; border-radius:8px; font-size:14px; cursor:pointer; font-weight:bold; color:#4e5968;">🔙 로비로</button>
                <div style="text-align:right;">
                    <div style="font-weight:bold; color:#333d4b; font-size:16px;">${room.room_name}</div>
                    <div style="font-size:12px; color:#8b95a1;">초대 코드: <span style="color:#3182f6;">${room.room_code}</span></div>
                </div>
            </div>
            <h3 style="color:#333d4b; margin-top:0; font-size:15px; margin-bottom:15px;">참여자 목록 (${room.members.length}명)</h3>
        `;

        html += room.members.map(f => {
            const isMe = f.email === myEmail;
            const isDelisted = f.status === 'delisted';
            const cardStyle = isDelisted ? "background: #f2f2f2; opacity: 0.6;" : (isMe ? "background: #f0f8ff; border: 1px solid #cce5ff;" : "cursor: pointer;");
            
            return `
                <div class="info-card" style="display: flex; justify-content: space-between; align-items: center; ${cardStyle}">
                    <div style="display: flex; align-items: center; gap: 15px;">
                        ${getAvatarHtml(f, 'small')}
                        <div>
                            <div style="font-size: 16px; font-weight: bold;">
                                <span style="color: ${f.nameColor || '#333d4b'};">${f.name}</span> 
                                ${isMe ? '<span style="font-size:11px; background:#3182f6; color:white; padding:2px 6px; border-radius:4px; margin-left:4px;">나</span>' : ''}
                                ${isDelisted ? '<span style="color:#ff3b30; font-size:12px;">(상폐)</span>' : ''}
                            </div>
                            ${getBadgeHtml(f)}
                        </div>
                    </div>
                    <div style="font-size: 16px; font-weight: bold; color: #333d4b;">
                        ${isDelisted ? '-' : Math.floor(f.price || 0).toLocaleString() + ' p'}
                    </div>
                </div>
            `;
        }).join('');
        list.innerHTML = html;
    }
}

function enterRoom(code) { currentRoomCode = code; renderHome(); }
function exitRoomView() { currentRoomCode = null; renderHome(); }

async function createNewRoom() {
    const name = prompt("새로 만들 방의 이름을 입력하세요 (예: 동네 친구방):");
    if(!name || name.trim() === "") return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/room/create`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: myEmail, room_name: name.trim() })
        });
        const data = await res.json();
        if(data.status === 'success') {
            alert(`🎉 '${data.room_name}' 방이 생성되었습니다!\n초대 코드: [ ${data.room_code} ]\n친구들에게 이 코드를 공유하세요!`);
            await initializeApp(); 
        }
    } catch(err) { alert("서버 오류가 발생했습니다."); }
}

async function joinExistingRoom() {
    const code = prompt("전달받은 6자리 초대 코드를 입력하세요:");
    if(!code || code.trim() === "") return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/room/join`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: myEmail, room_code: code.trim().toUpperCase() })
        });
        const data = await res.json();
        if(data.status === 'error') { alert(data.message); return; }
        alert(`🚪 '${data.room_name}' 방에 성공적으로 입장했습니다!`);
        await initializeApp(); 
    } catch(err) { alert("서버 오류가 발생했습니다."); }
}

// ==========================================
// ★ 전국구 랭킹 & 주주총회 복구
// ==========================================
function renderRanking() {
    const container = document.getElementById('ranking-content');
    if (!myProfile || globalRanking.length === 0) return;
    
    const top10 = globalRanking.slice(0, 10);
    const createTotalRankCard = (p, index) => {
        const medals = ['🥇', '🥈', '🥉']; const rankIcon = index < 3 ? medals[index] : `<span style="display:inline-block; width: 24px; text-align:center; color:#8b95a1; font-size:14px; font-weight:bold;">${index+1}</span>`;
        const isMe = p.name === myProfile.name;
        const bg = isMe ? "background:#f0f8ff;" : "";
        return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 10px; border-bottom: 1px solid #f9fafb; border-radius:8px; ${bg}">
            <div style="display: flex; align-items: center; font-size: 15px; font-weight: bold;">
                <span style="font-size: 18px; margin-right: 10px; width:20px; text-align:center;">${rankIcon}</span>
                ${getAvatarHtml(p, 'small')} 
                <span style="margin-left:10px; color: ${p.nameColor || '#333d4b'};">${p.name}</span> 
                ${isMe ? '<span style="font-size:11px; background:#3182f6; color:white; padding:2px 6px; border-radius:4px; margin-left:4px;">나</span>' : ''}
            </div>
            <div style="font-weight: bold; color: #333d4b;">${Math.floor(p.price||0).toLocaleString()} p</div>
        </div>`;
    };
    
    container.innerHTML = `
        <div style="background: white; border-radius: 16px; padding: 20px 15px; margin-bottom: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #eee;">
            <h3 style="margin-top: 0; color: #333d4b; display:flex; align-items:center; gap:8px;">🌍 전국구 통합 랭킹 Top 10</h3>
            <p style="font-size:12px; color:#8b95a1; margin-bottom:20px;">모든 단톡방의 주가가 합산된 전국구 랭킹입니다.</p>
            ${top10.map((p, i) => createTotalRankCard(p, i)).join('')}
        </div>
    `;
}

// ⚠️ 재판(주주총회) UI 완벽 복구
function renderMeeting() {
    const list = document.getElementById('meeting-list');
    if (!currentRoomCode) {
        list.innerHTML = '<div style="text-align:center; padding:50px 20px; color:#8b95a1; background:#f9fafb; border-radius:16px;">로비에서는 재판이 열리지 않습니다.<br>홈 탭에서 방에 먼저 입장해 주세요!</div>';
        return;
    }
    
    const room = myRooms.find(r => r.room_code === currentRoomCode);
    if (!room || !room.agendas || room.agendas.length === 0) { 
        list.innerHTML = `<div style="text-align:center; padding:50px 20px; color:#8b95a1; background:#f9fafb; border-radius:16px;">🕊️ [${room.room_name}] 방은 현재 평온합니다.<br>진행 중인 재판이 없습니다.</div>`; 
        return; 
    }
    
    list.innerHTML = room.agendas.map(a => {
        let titleColor = '#333d4b'; let titleText = '';
        if (a.type === 'revival') { titleColor = '#2e7d32'; titleText = '🌱 회생 재상장 건'; }
        else if (a.type === 'auto_delist') { titleColor = '#c62828'; titleText = '🚨 자동 상장폐지 심사'; }
        else { titleColor = '#ff3b30'; titleText = '📉 악평 재판 진행 중'; }

        const targetPerson = (a.target === myProfile.name) ? myProfile : room.members.find(f => f.name === a.target);
        const avatarHtml = targetPerson ? getAvatarHtml(targetPerson, 'small') : '';
        const targetColor = targetPerson && targetPerson.nameColor ? targetPerson.nameColor : '#333d4b';
        let stakeInfo = a.stakedAmount ? `<div style="color: #6b7684; font-size: 12px; margin-top: 4px; font-weight: bold;">⚖️ 소송 공탁금: ${Math.floor(a.stakedAmount).toLocaleString()} p</div>` : '';
        let btnHtml = (a.votedUsers && a.votedUsers.includes(myEmail)) ? 
            `<button style="flex:1; background:#e5e8eb; color:#8b95a1; border:none; padding:10px; border-radius:8px; cursor:not-allowed;" disabled>투표 완료</button>` : 
            `<button class="btn-vote-disagree" style="flex: 1; background: #e5e8eb; color: #4e5968;" onclick="voteMock()">반대 (기각)</button><button class="btn-vote-agree" style="flex: 1;" onclick="voteMock()">찬성 (확정)</button>`;

        return `<div class="info-card"><div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">${avatarHtml} <div><div style="color: ${titleColor}; font-weight: bold; margin-bottom: 2px;">[${titleText}]</div><div><b style="color: ${targetColor};">${a.target}</b></div></div></div><div>${a.reason}</div>${stakeInfo}<div style="margin:10px 0; font-size:13px;">찬성: ${a.agreeVotes} | 반대: ${a.disagreeVotes}</div><div style="display: flex; gap: 10px;">${btnHtml}</div></div>`;
    }).join('');
}

function voteMock() {
    showToast("방별 주주총회 투표 시스템은 서버 연동을 위해 공사 중입니다!");
}


// ==========================================
// ★ 프로필 (광고, VIP 등 100% 완전 복구)
// ==========================================

function watchAd(type) {
    const todayStr = new Date().toDateString();
    if (type === 'double_attendance') { if (myProfile.lastDailyAttendance !== todayStr) { showToast("먼저 일반 출석체크를 완료해주세요!"); return; } if (myProfile.lastDailyAdBonus === todayStr) { showToast("오늘은 이미 출석 보상 2배를 받았습니다!"); return; } } else if (type === 'extra_ticket') { if (myProfile.dailyAdTicketsDate !== todayStr) { myProfile.dailyAdTicketsCount = 0; myProfile.dailyAdTicketsDate = todayStr; } if (myProfile.dailyAdTicketsCount >= 1) { showToast("오늘은 더 이상 평가권을 받을 수 없습니다 (하루 최대 1회)."); return; } }
    currentAdRewardType = type;
    if (myProfile.isVIP) { claimAdReward(true); return; }
    document.getElementById('ad-modal').style.display = 'flex';
    let timeLeft = 3; document.getElementById('ad-timer').textContent = `광고 준비 중... (${timeLeft}초)`;
    const btn = document.getElementById('ad-close-btn'); btn.textContent = "광고를 끝까지 시청해주세요"; btn.style.background = "#e5e8eb"; btn.style.color = "#8b95a1"; btn.disabled = true; btn.onclick = null;
    adInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) { document.getElementById('ad-timer').textContent = `광고 시청 중... (${timeLeft}초)`; } 
        else { clearInterval(adInterval); document.getElementById('ad-timer').textContent = "✅ 시청 완료!"; btn.textContent = "보상 받기 🎁"; btn.style.background = "#3182f6"; btn.style.color = "white"; btn.disabled = false; btn.onclick = () => claimAdReward(false); }
    }, 1000);
}

function claimAdReward(isVipPass = false) {
    document.getElementById('ad-modal').style.display = 'none'; const todayStr = new Date().toDateString();
    if (currentAdRewardType === 'double_attendance') { myProfile.price += 50; if (myProfile.price > myProfile.maxPrice) myProfile.maxPrice = myProfile.price; myProfile.lastDailyAdBonus = todayStr; if (isVipPass) showToast("👑 VIP 프리패스! 즉시 50p가 상승했습니다."); else showToast("🎁 광고 보상! 주가가 추가로 50p 상승했습니다."); } else if (currentAdRewardType === 'extra_ticket') { myProfile.goodTickets += 1; myProfile.badTickets += 1; myProfile.dailyAdTicketsCount++; myProfile.dailyAdTicketsDate = todayStr; if (isVipPass) showToast(`👑 VIP 프리패스! 평가권 각 +1장 획득!`); else showToast(`🎁 광고 보상! 평가권 각 +1장 획득!`); }
    saveData(); renderProfile();
}

function openVIPModal() {
    document.getElementById('vip-modal').style.display = 'flex';
    if (myProfile.isVIP) { document.getElementById('vip-buy-section').style.display = 'none'; document.getElementById('vip-manage-section').style.display = 'block'; document.getElementById('vip-color-picker').value = myProfile.nameColor || '#333d4b'; } else { document.getElementById('vip-buy-section').style.display = 'block'; document.getElementById('vip-manage-section').style.display = 'none'; }
}
function closeVIPModal() { document.getElementById('vip-modal').style.display = 'none'; }
function buyVIP() { myProfile.isVIP = true; myProfile.nameColor = '#d4af37'; saveData(); showToast("💎 축하합니다! VIP 멤버십에 가입되었습니다."); openVIPModal(); renderProfile(); }
function applyVIPColor() { const color = document.getElementById('vip-color-picker').value; myProfile.nameColor = color; saveData(); showToast("🎨 이름 색상이 멋지게 변경되었습니다!"); closeVIPModal(); renderProfile(); }
function claimWeeklyTickets() { if (myProfile.weeklyTicketsClaimed) { showToast("이미 획득하셨습니다!"); return; } myProfile.goodTickets += 1; myProfile.badTickets += 1; myProfile.weeklyTicketsClaimed = true; showToast("🎫 평가권 각각 +1장 추가!"); saveData(); renderProfile(); }

function renderProfile() {
    const container = document.getElementById('my-profile-info');
    if(!myProfile) return;
    const isDelisted = myProfile.status === 'delisted';
    const changeAmount = myProfile.price - myProfile.basePrice; const changeRate = ((changeAmount / myProfile.basePrice) * 100).toFixed(1);
    const colorClass = changeAmount > 0 ? '#ff3b30' : (changeAmount < 0 ? '#3182f6' : '#8b95a1'); const sign = changeAmount > 0 ? '+' : '';
    
    const vipBanner = myProfile.isVIP 
        ? `<div style="background: linear-gradient(135deg, #d4af37, #f3e5f5); padding: 15px; border-radius: 12px; color: white; font-weight: bold; cursor: pointer; margin-bottom: 20px; text-align: left; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 10px rgba(212,175,55,0.3);" onclick="openVIPModal()"><div style="color:#333d4b;">👑 VIP 멤버십 혜택 적용 중</div><div style="font-size: 12px; background: rgba(255,255,255,0.4); color: #333d4b; padding: 6px 10px; border-radius: 6px;">설정 ⚙️</div></div>` 
        : `<div style="background: #333d4b; padding: 15px; border-radius: 12px; color: #d4af37; font-weight: bold; cursor: pointer; margin-bottom: 20px; text-align: left; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.1);" onclick="openVIPModal()"><div>💎 프리미엄 멤버십 가입하기</div><div style="font-size: 12px; background: rgba(255,255,255,0.1); padding: 6px 10px; border-radius: 6px; color:white;">알아보기 👉</div></div>`;
    
    const todayStr = new Date().toDateString(); 
    const hasDailyDone = myProfile.lastDailyAttendance === todayStr;
    const dailyBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: ${hasDailyDone ? '#e5e8eb' : '#e8f5e9'}; color: ${hasDailyDone ? '#8b95a1' : '#2e7d32'}; font-weight: bold; border: none; cursor: ${hasDailyDone ? 'not-allowed' : 'pointer'}; margin-bottom: 10px;" onclick="doDailyAttendance()" ${hasDailyDone ? 'disabled' : ''}>📅 매일 출석하고 전국 주가 올리기 (+50p)</button>`;
    
    const hasAdBonusDone = myProfile.lastDailyAdBonus === todayStr;
    let adDoubleBtn = '';
    if (hasDailyDone && !hasAdBonusDone) { adDoubleBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: #e3f2fd; color: #1565c0; font-weight: bold; border: none; cursor: pointer; margin-bottom: 10px;" onclick="watchAd('double_attendance')">🎬 광고 보고 출석 보상 한 번 더! (+50p)</button>`; } else if (hasDailyDone && hasAdBonusDone) { adDoubleBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: #e5e8eb; color: #8b95a1; font-weight: bold; border: none; cursor: not-allowed; margin-bottom: 10px;" disabled>✅ 출석 보상 2배 받기 완료</button>`; }

    const hasWeeklyDone = myProfile.weeklyTicketsClaimed === true;
    const weeklyBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: ${hasWeeklyDone ? '#e5e8eb' : '#fff3e0'}; color: ${hasWeeklyDone ? '#8b95a1' : '#e65100'}; font-weight: bold; border: none; cursor: ${hasWeeklyDone ? 'not-allowed' : 'pointer'}; margin-bottom: 10px;" onclick="claimWeeklyTickets()" ${hasWeeklyDone ? 'disabled' : ''}>🎁 이번 주 보너스 평가권 받기 (각 +1장)</button>`;

    if (myProfile.dailyAdTicketsDate !== todayStr) myProfile.dailyAdTicketsCount = 0; 
    const adTicketCount = myProfile.dailyAdTicketsCount || 0;
    const isAdTicketMax = adTicketCount >= 1;
    const adTicketBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: ${isAdTicketMax ? '#e5e8eb' : '#f3e5f5'}; color: ${isAdTicketMax ? '#8b95a1' : '#6a1b9a'}; font-weight: bold; border: none; cursor: ${isAdTicketMax ? 'not-allowed' : 'pointer'}; margin-bottom: 10px;" onclick="watchAd('extra_ticket')" ${isAdTicketMax ? 'disabled' : ''}>🎬 광고 보고 평가권 +1장 (오늘 ${adTicketCount}/1회)</button>`;

    let actionBtn = `${dailyBtn}${adDoubleBtn}${weeklyBtn}${adTicketBtn}`;
    if (isDelisted) {
        actionBtn = `<button style="width: 100%; padding: 15px; border-radius: 12px; background: #333d4b; color: white; font-weight: bold; border: none; cursor: pointer;" onclick="showToast('회생 투표 기능은 단톡방 연동 공사 중입니다!')">🙏 주주총회에 회생 투표 신청하기 (준비 중)</button>`;
    }

    container.innerHTML = `
        ${vipBanner}
        <div style="position: relative; display: inline-block;">
            ${getAvatarHtml(myProfile, 'large')}
            <button onclick="openProfileModal()" style="position: absolute; bottom: 0; right: -10px; background: #3182f6; color: white; border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 14px; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">✏️</button>
        </div>
        <h2 style="margin: 10px 0; color: ${myProfile.nameColor || '#333d4b'}; display:flex; justify-content:center; align-items:center; gap:8px;">
            ${myProfile.name} 코인
            <span onclick="changeNickname()" style="font-size:14px; color:#8b95a1; background:#f2f4f6; padding:4px 8px; border-radius:6px; cursor:pointer;">변경</span>
        </h2>
        <div style="font-size:12px; color:#8b95a1; margin-bottom:10px;">내 주가는 모든 방에 동일하게 적용됩니다.</div>
        ${getBadgeHtml(myProfile)}
        <div style="display: flex; justify-content: space-around; margin: 20px 0;">
            <div style="background: #f9fafb; padding: 15px; border-radius: 12px; width: 40%; box-shadow: 0 2px 4px rgba(0,0,0,0.02);"><div style="font-size: 13px; color: #8b95a1;">남은 호평권 👍</div><div style="font-size: 20px; font-weight: bold; color: #ff3b30;">${myProfile.goodTickets} 장</div></div>
            <div style="background: #f9fafb; padding: 15px; border-radius: 12px; width: 40%; box-shadow: 0 2px 4px rgba(0,0,0,0.02);"><div style="font-size: 13px; color: #8b95a1;">남은 악평권 👎</div><div style="font-size: 20px; font-weight: bold; color: #3182f6;">${myProfile.badTickets} 장</div></div>
        </div>
        <div style="font-size: 32px; font-weight: bold; color: #333d4b; margin-top: 20px;">${isDelisted ? '-' : Math.floor(myProfile.price).toLocaleString()} p</div>
        <div style="font-weight: bold; color: ${colorClass}; margin-bottom: 30px;">${isDelisted ? '' : sign + Math.floor(changeAmount).toLocaleString() + ' p (' + sign + changeRate + '%)'}</div>
        
        ${actionBtn}
        <button style="width: 100%; padding: 12px; border-radius: 12px; background: #ffebee; color: #c62828; font-weight: bold; border: none; cursor: pointer; margin-top: 20px;" onclick="handleLogout()">🚪 로그아웃</button>
    `;
}

function doDailyAttendance() { const today = new Date().toDateString(); if (myProfile.lastDailyAttendance === today) { showToast("이미 완료하셨습니다!"); return; } myProfile.price += 50; if (myProfile.price > myProfile.maxPrice) myProfile.maxPrice = myProfile.price; myProfile.lastDailyAttendance = today; showToast("💵 일일 출석 완료! 글로벌 주가 상승!"); saveData(); renderProfile(); }
function openProfileModal() { document.getElementById('profile-modal').style.display = 'flex'; const grid = document.getElementById('default-profiles-grid'); grid.innerHTML = DEFAULT_AVATARS.map(url => `<div onclick="selectDefaultProfile('${url}')" style="cursor: pointer; border-radius: 12px; overflow: hidden; background: #f2f4f6; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: transform 0.1s;"><img src="${url}" style="width: 100%; height: 100%; display: block; object-fit: cover;"></div>`).join(''); }
function closeProfileModal() { document.getElementById('profile-modal').style.display = 'none'; }
function selectDefaultProfile(url) { myProfile.profileImage = url; saveData(); showToast("기본 프로필로 변경되었습니다!"); closeProfileModal(); renderProfile(); }

async function changeNickname() {
    const newName = prompt("변경할 새 닉네임을 입력하세요 (최대 8자):");
    if(!newName || newName.trim() === "") return;
    if(newName.trim() === myProfile.name) return;
    const hasSpecialChar = /[^a-zA-Z0-9가-힣]/.test(newName.trim());
    if (hasSpecialChar) { alert("특수문자나 공백은 사용할 수 없습니다."); return; }
    const isOnlyEnglish = /^[a-zA-Z0-9]+$/.test(newName.trim()); 
    if (isOnlyEnglish) { if (newName.trim().length < 2 || newName.trim().length > 10) { alert("영어/숫자 닉네임은 2~10자로 정해주세요."); return; } } 
    else { if (newName.trim().length < 2 || newName.trim().length > 8) { alert("한글 닉네임은 2~8자로 정해주세요."); return; } }

    try {
        const res = await fetch(`${BACKEND_URL}/api/check-nickname?nickname=${encodeURIComponent(newName.trim())}`);
        const data = await res.json();
        if(!data.available) { alert(data.message); return; }
        
        myProfile.name = newName.trim(); myUsername = myProfile.name;
        localStorage.setItem('fc_username', myUsername);
        saveData(); showToast("닉네임 변경 완료! ✏️"); renderProfile();
    } catch(err) { alert("오류가 발생했습니다."); }
}

document.getElementById('custom-image-upload').addEventListener('change', async function(e) {
    const file = e.target.files[0]; if(!file) return; 
    showToast("⏳ 서버를 통해 이미지를 업로드 중...");
    const formData = new FormData(); formData.append("image", file);
    try {
        const response = await fetch(`${BACKEND_URL}/api/upload`, { method: "POST", body: formData });
        const data = await response.json();
        if (data.url) { myProfile.profileImage = data.url; saveData(); showToast("📸 프로필 사진이 저장되었습니다!"); closeProfileModal(); renderProfile(); } 
        else { showToast("🚨 서버 업로드 실패!"); }
    } catch(err) { console.error(err); showToast("🚨 네트워크 오류가 발생했습니다."); }
});

// ==========================================
// ★ 로그인 & 앱 초기화 라우팅
// ==========================================
function decodeJwtResponse(token) {
    let base64Url = token.split('.')[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join('')));
}

function showLoginScreen() {
    let loginDiv = document.getElementById('login-overlay');
    if (!loginDiv) {
        loginDiv = document.createElement('div'); loginDiv.id = 'login-overlay';
        loginDiv.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:#f2f4f6; z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;";
        document.body.appendChild(loginDiv);
    }
    
    loginDiv.innerHTML = `
        <div style="background:white; padding:40px 30px; border-radius:20px; box-shadow:0 10px 20px rgba(0,0,0,0.1); text-align:center; width:80%; max-width:350px;">
            <div style="font-size:50px; margin-bottom:15px;">🪙</div>
            <h1 style="margin:0 0 10px 0; color:#333d4b; font-size:24px;">친구 코인 접속</h1>
            <p style="color:#8b95a1; margin-bottom:30px; font-size:14px;">원하는 접속 방식을 선택해주세요.</p>
            
            <button onclick="triggerGoogleIntent('login')" style="width:100%; padding:15px; background:#333d4b; color:white; border:none; border-radius:12px; font-size:16px; font-weight:bold; cursor:pointer; margin-bottom:10px;">기존 계정으로 로그인</button>
            <button onclick="triggerGoogleIntent('signup')" style="width:100%; padding:15px; background:#e8f5e9; color:#2e7d32; border:none; border-radius:12px; font-size:16px; font-weight:bold; cursor:pointer; margin-bottom:25px;">새로 시작하기 (회원가입)</button>
            
            <div id="google-btn-container" style="display:none; justify-content:center;"></div>
        </div>
    `;

    if (!document.getElementById('google-jssdk')) {
        const script = document.createElement('script'); script.id = 'google-jssdk'; script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.defer = true;
        script.onload = () => {
            google.accounts.id.initialize({ client_id: "837250448431-hrlfbnof2bf4acofs03e28t3qdpkun5g.apps.googleusercontent.com", callback: handleCredentialResponse });
            google.accounts.id.renderButton(document.getElementById("google-btn-container"), { theme: "outline", size: "large", text: "signin_with", shape: "pill" });
        };
        document.head.appendChild(script);
    } else {
        google.accounts.id.initialize({ client_id: "837250448431-hrlfbnof2bf4acofs03e28t3qdpkun5g.apps.googleusercontent.com", callback: handleCredentialResponse });
        google.accounts.id.renderButton(document.getElementById("google-btn-container"), { theme: "outline", size: "large", text: "signin_with", shape: "pill" });
    }
}

function triggerGoogleIntent(intent) {
    loginIntent = intent; 
    document.getElementById('google-btn-container').style.display = 'flex'; 
}

async function handleCredentialResponse(response) {
    const responsePayload = decodeJwtResponse(response.credential); 
    const tempEmail = responsePayload.email;
    const overlay = document.getElementById('login-overlay');
    if(overlay) overlay.innerHTML = `<div style="font-size:20px; font-weight:bold; color:#333d4b;">서버 확인 중... ⏳</div>`; 
    
    try {
        const serverResponse = await fetch(`${BACKEND_URL}/api/data/${encodeURIComponent(tempEmail)}`);
        const serverData = await serverResponse.json();
        
        if (loginIntent === 'login') {
            if (serverData.isNewUser) { alert("가입된 정보가 없습니다. 새로 시작하기(회원가입)를 진행해 주세요."); localStorage.clear(); location.reload(); return; }
        } else if (loginIntent === 'signup') {
            if (!serverData.isNewUser) { alert("이미 가입된 계정입니다. 안전하게 로그인으로 연결합니다."); }
        }
        
        myEmail = tempEmail; localStorage.setItem('fc_email', myEmail); 
        
        if (serverData.isNewUser) { showNicknameSetupScreen(responsePayload.picture); } 
        else {
            myProfile = serverData.profile; myUsername = myProfile.name; localStorage.setItem('fc_username', myUsername);
            myNotifications = serverData.noti || [];
            myRooms = serverData.my_rooms || [];
            globalRanking = serverData.global_ranking || [];
            
            if(overlay) overlay.remove();
            finishSetup();
        }
    } catch(err) { alert("서버 연결에 실패했습니다."); localStorage.clear(); location.reload(); }
}

function handleLogout() { localStorage.clear(); location.reload(); }

function showNicknameSetupScreen(googlePicture) {
    let overlay = document.getElementById('login-overlay');
    overlay.innerHTML = `
        <div style="background:white; padding:40px 30px; border-radius:20px; box-shadow:0 10px 20px rgba(0,0,0,0.1); text-align:center; width:80%; max-width:350px;">
            <div style="font-size:40px; margin-bottom:15px;">👋</div>
            <h1 style="margin:0 0 10px 0; color:#333d4b; font-size:22px;">환영합니다!</h1>
            <p style="color:#8b95a1; margin-bottom:20px; font-size:14px;">앱에서 사용할 닉네임을 정해주세요.</p>
            <input type="text" id="new-nickname-input" placeholder="닉네임 입력 (특수문자/공백 불가)" style="width:100%; padding:15px; border:1px solid #e5e8eb; border-radius:12px; font-size:16px; margin-bottom:10px; box-sizing:border-box; text-align:center; outline:none;">
            <p id="nickname-error" style="color:#ff3b30; font-size:12px; margin-bottom:20px; height:15px;"></p>
            <button onclick="submitNewNickname('${googlePicture || ''}')" id="nickname-submit-btn" style="width:100%; padding:15px; background:#3182f6; color:white; border:none; border-radius:12px; font-size:16px; font-weight:bold; cursor:pointer;">시작하기 🚀</button>
        </div>
    `;
}

async function submitNewNickname(googlePicture) {
    const inputEl = document.getElementById('new-nickname-input'); const errorEl = document.getElementById('nickname-error');
    const newName = inputEl.value.trim();
    if(!newName) { errorEl.textContent = "닉네임을 입력해주세요!"; return; }
    if (/[^a-zA-Z0-9가-힣]/.test(newName)) { errorEl.textContent = "특수문자나 공백은 사용할 수 없습니다."; return; }
    if (/^[a-zA-Z0-9]+$/.test(newName)) { if (newName.length < 2 || newName.length > 10) { errorEl.textContent = "영어/숫자 닉네임은 2~10자로 정해주세요."; return; } } 
    else { if (newName.length < 2 || newName.length > 8) { errorEl.textContent = "한글 닉네임은 2~8자로 정해주세요."; return; } }

    try {
        const res = await fetch(`${BACKEND_URL}/api/check-nickname?nickname=${encodeURIComponent(newName)}`);
        const data = await res.json();
        if(!data.available) { errorEl.textContent = data.message; return; }
        
        myProfile = JSON.parse(JSON.stringify(defaultProfile));
        myProfile.name = newName; if (googlePicture) myProfile.profileImage = googlePicture;
        myUsername = newName; localStorage.setItem('fc_username', myUsername);
        myNotifications = []; myRooms = []; globalRanking = [];
        
        saveData(); 
        
        const overlay = document.getElementById('login-overlay'); if(overlay) overlay.remove();
        finishSetup();
    } catch(err) { errorEl.textContent = "서버 연결에 실패했습니다."; }
}

async function initializeApp() {
    try {
        const serverResponse = await fetch(`${BACKEND_URL}/api/data/${encodeURIComponent(myEmail)}`);
        const serverData = await serverResponse.json();
        
        if (serverData.isNewUser) { showLoginScreen(); return; }
        
        myProfile = serverData.profile; myUsername = myProfile.name;
        myNotifications = serverData.noti || [];
        myRooms = serverData.my_rooms || [];
        globalRanking = serverData.global_ranking || [];
        
        const overlay = document.getElementById('login-overlay'); if(overlay) overlay.remove();
        finishSetup();
    } catch(err) { console.error(err); alert("서버 통신 오류가 발생했습니다."); finishSetup(); }
}

function finishSetup() {
    if (myProfile && myProfile.isVIP === undefined) { myProfile.isVIP = false; myProfile.nameColor = '#333d4b'; }
    if (myProfile && !myProfile.badges) myProfile.badges = [];
    if (myProfile && !myProfile.stats) myProfile.stats = { goodGiven: 0, badGiven: 0, trialCount: 0 };
    checkRefill(); checkBadges(); updateTicker(); switchTab('home'); 
}

window.onload = () => { 
    if (!myEmail) { showLoginScreen(); } 
    else { initializeApp(); }
};