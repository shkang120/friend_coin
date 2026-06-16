const BACKEND_URL = "https://friend-coin.onrender.com"; // ★ 본인의 진짜 주소 확인

let myEmail = localStorage.getItem('fc_email') || null; 
let myUsername = localStorage.getItem('fc_username') || null;
let loginIntent = ''; 
let autoSyncInterval = null; 
let isSyncing = false; 

if (!document.getElementById('stamp-style')) {
    const style = document.createElement('style');
    style.id = 'stamp-style';
    style.innerHTML = `
        @keyframes stampDrop {
            0% { transform: scale(3) rotate(-30deg); opacity: 0; }
            50% { transform: scale(0.9) rotate(-10deg); opacity: 1; }
            100% { transform: scale(1) rotate(-15deg); opacity: 0.9; }
        }
        .verdict-stamp {
            position: absolute; top: 15px; right: 15px;
            border: 4px solid; padding: 5px 15px;
            font-size: 22px; font-weight: 900; border-radius: 8px;
            font-family: 'Times New Roman', serif; letter-spacing: 2px;
            animation: stampDrop 0.4s cubic-bezier(0.25, 1, 0.5, 1) forwards;
            z-index: 10; pointer-events: none; background: rgba(255,255,255,0.85);
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
    `;
    document.head.appendChild(style);
}

function escapeHtml(text) {
    if (!text) return "";
    return text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function getCurrentTime() {
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function getFormattedDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${date}`;
}

function getYesterdayClosePrice(profile) {
    if (!profile || !profile.priceHistory || !profile.timeHistory || profile.priceHistory.length === 0) return profile.basePrice || 20000;
    
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kstNow = new Date(utc + (9 * 3600000));
    const todayStr = String(kstNow.getMonth() + 1).padStart(2, '0') + '.' + String(kstNow.getDate()).padStart(2, '0');
    
    let yesterdayPrice = profile.priceHistory[0]; 
    for (let i = profile.timeHistory.length - 1; i >= 0; i--) {
        const timeStr = profile.timeHistory[i];
        if (timeStr === "시작") { yesterdayPrice = profile.priceHistory[i]; break; }
        if (timeStr && !timeStr.startsWith(todayStr)) { yesterdayPrice = profile.priceHistory[i]; break; }
    }
    return yesterdayPrice;
}

const defaultProfile = { 
    name: "", profileImage: "", emoji: "👨‍💻", price: 20000, basePrice: 20000, maxPrice: 20000, status: 'active',
    goodTickets: 2, badTickets: 2, lastDailyAttendance: null, weeklyTicketsClaimed: false,
    lastDailyAdBonus: null, dailyAdTicketsDate: null, dailyAdTicketsCount: 0, 
    badges: [], stats: { goodGiven: 0, badGiven: 0, trialCount: 0 },
    isVIP: false, nameColor: "#333d4b",
    priceHistory: [], timeHistory: [],
    pending_evals: [], 
    defense_count: 0, defense_month: "" 
};

let myProfile = null; let myNotifications = []; let myRooms = []; let globalRanking = [];   
let currentRoomCode = null; let currentAdRewardType = null; let adInterval = null; let currentSelectedFriend = null; 

let evalState = { type: null, intensity: null, p1: 0, p2: 0, p3: 0 };

let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calSelectedDate = getFormattedDate(new Date());

const DEFAULT_AVATARS = [
    'https://api.dicebear.com/7.x/bottts/svg?seed=Felix&backgroundColor=b6e3f4', 'https://api.dicebear.com/7.x/bottts/svg?seed=Aneka&backgroundColor=c0aede',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Oliver&backgroundColor=ffd5dc', 'https://api.dicebear.com/7.x/bottts/svg?seed=Sophie&backgroundColor=d1d4f9',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Jack&backgroundColor=ffdfbf', 'https://api.dicebear.com/7.x/bottts/svg?seed=Mia&backgroundColor=b6e3f4',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Leo&backgroundColor=c0aede', 'https://api.dicebear.com/7.x/bottts/svg?seed=Chloe&backgroundColor=ffd5dc',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Sam&backgroundColor=d1d4f9', 'https://api.dicebear.com/7.x/bottts/svg?seed=Zoe&backgroundColor=ffdfbf'
];

function showToast(msg) { const toast = document.getElementById('toast'); if(toast) { toast.textContent = msg; toast.classList.add('show'); setTimeout(() => { toast.classList.remove('show'); }, 3000); } }

function getAvatarHtml(person, size = 'small') {
    const sizePx = size === 'large' ? '100px' : '40px'; const radius = size === 'large' ? '24px' : '14px'; 
    const isDelisted = person.status === 'delisted'; const filter = isDelisted ? 'grayscale(100%) opacity(50%)' : 'none';
    if (person.profileImage) return `<img src="${person.profileImage}" style="width:${sizePx}; height:${sizePx}; border-radius:${radius}; object-fit:cover; display:inline-block; vertical-align:middle; background:#f2f4f6; box-shadow: 0 2px 8px rgba(0,0,0,0.1); filter:${filter};">`;
    else return `<span style="display:inline-block; width:${sizePx}; height:${sizePx}; line-height:${sizePx}; text-align:center; font-size:${size === 'large' ? '50px' : '20px'}; background:#f9fafb; border-radius:${radius}; vertical-align:middle; box-shadow: 0 2px 8px rgba(0,0,0,0.05); filter:${filter};">${isDelisted ? '💀' : person.emoji || '👤'}</span>`;
}
function getBadgeHtml(person) { let allBadges = [...(person.dynamicBadges || []), ...(person.badges || [])]; if (allBadges.length === 0) return ''; return `<div style="display:flex; gap:4px; margin-top:4px; flex-wrap:wrap;">` + allBadges.map(b => `<span style="font-size:10px; background:#f2f4f6; padding:2px 6px; border-radius:4px; color:#4e5968;">${b}</span>`).join('') + `</div>`; }

function renderNoti() {
    const container = document.getElementById('noti-list'); if (!container) return;
    let html = '';
    if (myProfile && myProfile.pending_evals && myProfile.pending_evals.length > 0) {
        html += `<div style="background:#fff3f3; padding:15px; border-radius:12px; margin-bottom:15px; border:1px solid #ffe3e3;"><h4 style="margin:0 0 10px 0; color:#ff3b30; font-size:14px;">⚠️ 승인 대기 중인 악평 목록</h4>`;
        html += myProfile.pending_evals.map(e => `
            <div style="background:white; padding:12px; border-radius:8px; border:1px solid #ffd5d5; margin-bottom:8px; font-size:13px; color:#333d4b;">
                <div>👤 <b>${escapeHtml(e.evaluator_name)}</b>의 악평 변동건: <b style="color:#3182f6;">-${e.intensity}%</b></div>
                <div style="background:#f9fafb; padding:6px; border-radius:4px; margin:6px 0; color:#6b7684; font-size:12px;">💬 사유: ${escapeHtml(e.reason)}</div>
                <div style="font-size:11px; color:#ff3b30; margin-bottom:8px; font-weight:bold;">⏳ 24시간 무응답 시 강제 수락됩니다.</div>
                <div style="display:flex; gap:6px;">
                    <button onclick="respondPendingEval('${e.id}', 'approve')" style="flex:1; padding:6px; background:#3182f6; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">👍 감수하고 승인</button>
                    <button onclick="respondPendingEval('${e.id}', 'defend')" style="flex:1; padding:6px; background:#ff3b30; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">⚖️ 이의제기 (재판)</button>
                </div>
            </div>
        `).join('');
        html += `</div>`;
    }
    if (!myNotifications || myNotifications.length === 0) { 
        if(!html) { container.innerHTML = '<div style="text-align:center; padding:40px; color:#8b95a1;">새로운 알림이 없습니다.</div>'; return; }
    } else {
        html += myNotifications.map(n => `<div style="padding:15px; border-bottom:1px solid #f2f4f6; color:#333d4b;">${escapeHtml(n)}</div>`).join('');
    }
    container.innerHTML = html;
}

async function respondPendingEval(evalId, action) {
    const token = localStorage.getItem('fc_id_token');
    if(action === 'defend') {
        const curMonth = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, '0');
        let count = myProfile.defense_month === curMonth ? (myProfile.defense_count || 0) : 0;
        if(count >= 3) { alert("🚨 이번 달 방어 재판권(3회)을 모두 소모하셨습니다! 이 악평은 무조건 승인해야 합니다."); return; }
        if(!confirm(`⚖️ 이 악평에 대해 해명 재판을 발의하시겠습니까?\n(이번 달 남은 방어 기회: ${3 - count}회)`)) return;
    }
    showToast("⏳ 처리 요청 중...");
    try {
        const res = await fetch(`${BACKEND_URL}/api/evaluate/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ email: myEmail, eval_id: evalId, action: action }) });
        const data = await res.json();
        if(data.status === 'success') { alert(data.message); await forceSync(); switchTab('noti'); } else { alert(data.message); }
    } catch(err) { alert("통신 실패"); }
}

function checkBadges() {
    if (!myProfile || !myProfile.badges) return;
    if (myProfile.stats.goodGiven >= 2 && !myProfile.badges.includes('👼천사')) { myProfile.badges.push('👼천사'); showToast('🎉 [칭호 획득] 👼천사'); }
    if (myProfile.stats.badGiven >= 2 && !myProfile.badges.includes('😈악마')) { myProfile.badges.push('😈악마'); showToast('🎉 [칭호 획득] 😈악마'); }
    if (myProfile.stats.trialCount >= 2 && !myProfile.badges.includes('⚖️법정단골')) { myProfile.badges.push('⚖️법정단골'); showToast('🎉 [칭호 획득] ⚖️법정단골'); }
    if (globalRanking.length === 0) return;
    const top1 = globalRanking[0]; const topGainer = [...globalRanking].sort((a,b) => ((b.price||0) - (b.basePrice||0)) - ((a.price||0) - (a.basePrice||0)))[0];
    globalRanking.forEach(p => { p.dynamicBadges = []; if (p.isVIP) p.dynamicBadges.push('👑VIP'); if (top1 && p.name === top1.name) p.dynamicBadges.push('👑1위'); if (topGainer && p.name === topGainer.name && (p.price - p.basePrice) > 0) p.dynamicBadges.push('🚀떡상왕'); });
}

function updateTicker() {
    const tickerEl = document.getElementById('ticker-text'); if(!tickerEl || !myProfile || globalRanking.length === 0) return; 
    tickerEl.innerHTML = `[글로벌 시황] 👑 전국 1위: ${globalRanking[0].name} (${Math.floor(globalRanking[0].price||0).toLocaleString()}p) &nbsp;&nbsp;&nbsp;&nbsp; | &nbsp;&nbsp;&nbsp;&nbsp; [공지] 프라이빗 투자 클럽 내부 채팅방 기능 업데이트!`;
}

function saveData() { 
    checkBadges(); updateTicker(); if (!myEmail) return;
    fetch(`${BACKEND_URL}/api/save`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ profile: myProfile, noti: myNotifications }) }).catch(err => console.error(err));
}

function switchTab(tabName) {
    if(!myProfile) return; checkBadges();
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('view-active'); });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const targetView = document.getElementById(tabName + '-view'); if (targetView) targetView.classList.add('view-active');
    const tabIndex = { 'home': 0, 'meeting': 1, 'ranking': 2, 'noti': 3, 'profile': 4 }[tabName];
    const navItems = document.querySelectorAll('.nav-item'); if (navItems[tabIndex]) navItems[tabIndex].classList.add('active');
    
    if (tabName === 'home') renderHome(); 
    if (tabName === 'meeting') renderMeeting(); 
    if (tabName === 'ranking') renderRanking(); 
    if (tabName === 'noti') renderNoti(); 
    if (tabName === 'profile') renderProfile();

    forceSync();
}

function getCalendarHtml(room) {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const realToday = getFormattedDate(new Date()); 
    
    let gridHtml = '<div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:5px; text-align:center; font-size:12px; margin-bottom:10px;">';
    const days = ['일','월','화','수','목','금','토'];
    days.forEach(d => gridHtml += `<div style="font-weight:bold; color:#8b95a1; padding-bottom:5px;">${d}</div>`);
    for(let i=0; i<firstDay; i++) gridHtml += `<div></div>`;
    
    for(let i=1; i<=daysInMonth; i++) {
        const dStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
        const dayEvents = (room.events || []).filter(e => {
            const start = e.start_date || e.date; 
            const end = e.end_date || start;
            return dStr >= start && dStr <= end;
        });
        
        const hasEvent = dayEvents.length > 0;
        const isSelected = calSelectedDate === dStr;
        const isToday = realToday === dStr;
        
        let dotHtml = '';
        if (hasEvent) {
            let dots = '';
            const dotsCount = Math.min(dayEvents.length, 3);
            const dotColors = ['#ff3b30', '#3182f6', '#34c759']; 
            for(let j=0; j<dotsCount; j++) {
                dots += `<div style="width:4px; height:4px; background:${dotColors[j]}; border-radius:50%;"></div>`;
            }
            dotHtml = `<div style="display:flex; justify-content:center; gap:3px; margin-top:2px;">${dots}</div>`;
        }
        
        const bg = isSelected ? '#3182f6' : (hasEvent ? '#fff3f3' : 'transparent');
        const color = isSelected ? 'white' : (isToday && !isSelected ? '#3182f6' : '#333d4b');
        const border = isToday && !isSelected ? 'border:2px solid #3182f6;' : 'border:2px solid transparent;';
        
        gridHtml += `<div onclick="selectCalDate('${dStr}')" style="padding:4px; border-radius:8px; cursor:pointer; background:${bg}; color:${color}; font-weight:${hasEvent||isSelected||isToday?'bold':'normal'}; ${border} box-sizing:border-box; transition:0.2s;">${i}${dotHtml}</div>`;
    }
    gridHtml += '</div>';

    let selectedEventsHtml = '';
    if (calSelectedDate) {
        const dayEvents = (room.events || []).filter(e => {
            const start = e.start_date || e.date;
            const end = e.end_date || start;
            return calSelectedDate >= start && calSelectedDate <= end;
        });
        
        selectedEventsHtml = `<div style="background:#f9fafb; padding:10px; border-radius:10px; border:1px solid #e5e8eb;">
            <div style="font-weight:bold; font-size:13px; color:#333d4b; margin-bottom:10px;">📅 ${calSelectedDate} 일정</div>
            ${dayEvents.map((e, index) => {
                const dateTag = (e.start_date !== e.end_date && e.end_date) ? `<span style="font-size:10px; background:#e8f5e9; color:#2e7d32; padding:2px 4px; border-radius:4px;">${e.start_date.slice(5)} ~ ${e.end_date.slice(5)}</span>` : '';
                const dotColors = ['#ff3b30', '#3182f6', '#34c759'];
                const indicatorColor = index < 3 ? dotColors[index] : '#8b95a1';
                
                return `<div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:8px; border-radius:6px; margin-bottom:6px; border:1px solid #eee; border-left:4px solid ${indicatorColor};">
                    <div style="font-size:13px; color:#333d4b;"><b>${escapeHtml(e.title)}</b> ${dateTag} <span style="font-size:11px; color:#8b95a1;">(${escapeHtml(e.creator_name)})</span></div>
                    <button onclick="deleteEvent('${e.id}')" style="background:none; border:none; color:#ff3b30; font-size:12px; cursor:pointer;">❌</button>
                </div>`
            }).join('')}
            ${dayEvents.length === 0 ? `<div style="font-size:12px; color:#8b95a1; text-align:center; margin-bottom:10px;">등록된 약속이 없습니다.</div>` : ''}
            <button onclick="openAddEventModal('${calSelectedDate}')" style="width:100%; padding:8px; background:#3182f6; color:white; border:none; border-radius:8px; font-size:12px; font-weight:bold; cursor:pointer;">+ 일정 추가</button>
        </div>`;
    }

    return `
        <div style="background:white; border-radius:16px; padding:15px; margin-bottom:20px; border:1px solid #e5e8eb; box-shadow:0 2px 4px rgba(0,0,0,0.02);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div style="font-size:14px; font-weight:bold; color:#333d4b;">🗓️ 클럽 공유 캘린더</div>
                <div style="display:flex; align-items:center; gap:5px;">
                    <button onclick="changeCalMonth(-1)" style="background:none; border:none; cursor:pointer; color:#8b95a1; padding:0 5px;">◀</button>
                    <input type="date" value="${calSelectedDate}" onchange="handleDatePickerChange(this.value)" style="font-size:14px; font-weight:bold; color:#333d4b; border:none; outline:none; background:transparent; cursor:pointer; font-family:sans-serif; text-align:center; width:125px;">
                    <button onclick="changeCalMonth(1)" style="background:none; border:none; cursor:pointer; color:#8b95a1; padding:0 5px;">▶</button>
                </div>
            </div>
            ${gridHtml}
            ${selectedEventsHtml}
        </div>
    `;
}

window.changeCalMonth = function(offset) { calMonth += offset; if(calMonth < 0) { calMonth = 11; calYear--; } if(calMonth > 11) { calMonth = 0; calYear++; } renderHome(); };
window.selectCalDate = function(dStr) { calSelectedDate = dStr; renderHome(); };
window.handleDatePickerChange = function(val) { if(!val) return; const d = new Date(val); calYear = d.getFullYear(); calMonth = d.getMonth(); calSelectedDate = val; renderHome(); };

window.openAddEventModal = function(dateStr) {
    let modal = document.getElementById('event-modal');
    if(!modal) { modal = document.createElement('div'); modal.id = 'event-modal'; modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; display:none; justify-content:center; align-items:center;"; document.body.appendChild(modal); }
    modal.innerHTML = `
        <div style="background:white; padding:25px; border-radius:20px; width:85%; max-width:340px; text-align:left; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <h3 style="margin-top:0; color:#333d4b; text-align:center; font-size:18px;">🗓️ 일정 추가</h3>
            <label style="font-size:12px; font-weight:bold; color:#4e5968; display:block; margin-bottom:6px;">1. 일정 내용</label>
            <input type="text" id="event-title-input" placeholder="예: 부산 2박 3일 여행" style="width:100%; padding:12px; border:1px solid #e5e8eb; border-radius:10px; margin-bottom:15px; box-sizing:border-box; outline:none; font-family:sans-serif;">
            
            <div style="display:flex; gap:10px; margin-bottom:20px;">
                <div style="flex:1;">
                    <label style="font-size:12px; font-weight:bold; color:#4e5968; display:block; margin-bottom:6px;">시작일</label>
                    <input type="date" id="event-start-input" value="${dateStr}" style="width:100%; padding:10px; border:1px solid #e5e8eb; border-radius:10px; box-sizing:border-box; outline:none; font-family:sans-serif; font-size:13px;">
                </div>
                <div style="flex:1;">
                    <label style="font-size:12px; font-weight:bold; color:#4e5968; display:block; margin-bottom:6px;">종료일</label>
                    <input type="date" id="event-end-input" value="${dateStr}" style="width:100%; padding:10px; border:1px solid #e5e8eb; border-radius:10px; box-sizing:border-box; outline:none; font-family:sans-serif; font-size:13px;">
                </div>
            </div>
            <div style="display:flex; gap:10px;">
                <button onclick="document.getElementById('event-modal').style.display='none'" style="flex:1; padding:12px; background:#f2f4f6; border:none; border-radius:10px; font-weight:bold; color:#8b95a1; cursor:pointer;">취소</button>
                <button onclick="submitNewEvent()" style="flex:1; padding:12px; background:#3182f6; border:none; border-radius:10px; font-weight:bold; color:white; cursor:pointer;">추가하기</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
};

window.submitNewEvent = async function() {
    const title = document.getElementById('event-title-input').value.trim(); const start = document.getElementById('event-start-input').value; const end = document.getElementById('event-end-input').value;
    if(!title) { alert("일정 내용을 입력하세요!"); return; } if(start > end) { alert("종료일이 시작일보다 빠를 수 없습니다!"); return; }
    document.getElementById('event-modal').style.display = 'none'; showToast("⏳ 일정 등록 중...");
    try {
        const res = await fetch(`${BACKEND_URL}/api/room/event/add`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ room_code: currentRoomCode, start_date: start, end_date: end, title: title, creator_name: myProfile.name, creator_email: myEmail }) });
        const data = await res.json(); if(data.status === 'success') { await forceSync(); switchTab('home'); } else { alert(data.message); }
    } catch(err) { alert("통신 에러"); }
};

window.deleteEvent = async function(eventId) {
    if(!confirm("이 일정을 삭제하시겠습니까?")) return; showToast("⏳ 삭제 중...");
    try {
        const res = await fetch(`${BACKEND_URL}/api/room/event/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ room_code: currentRoomCode, event_id: eventId, deleter_email: myEmail }) });
        const data = await res.json(); if(data.status === 'success') { await forceSync(); } else { alert(data.message); }
    } catch(err) { alert("통신 에러"); }
};

function renderHome() {
    const list = document.getElementById('friend-list'); if(!list) return;
    if (!currentRoomCode) { 
        let html = `<div style="display:flex; gap:10px; margin-bottom:20px;"><button onclick="createNewRoom()" style="flex:1; padding:15px; background:#333d4b; color:white; border-radius:12px; font-weight:bold; border:none; cursor:pointer; box-shadow:0 4px 6px rgba(0,0,0,0.1);">+ 새 클럽 개설</button><button onclick="joinExistingRoom()" style="flex:1; padding:15px; background:#e8f5e9; color:#2e7d32; border-radius:12px; font-weight:bold; border:none; cursor:pointer; box-shadow:0 4px 6px rgba(0,0,0,0.05);">🔑 코드로 입장</button></div><h3 style="color:#333d4b; margin-top:0; font-size:16px;">내 투자 클럽 목록</h3>`;
        if (myRooms.length === 0) { html += `<div style="text-align:center; padding:50px 20px; color:#8b95a1; background:#f9fafb; border-radius:16px;">가입된 투자 클럽이 없습니다.</div>`; } 
        else { html += myRooms.map(r => `<div onclick="enterRoom('${r.room_code}')" class="info-card" style="cursor:pointer; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; border:2px solid transparent; transition:0.2s;" onmouseover="this.style.borderColor='#3182f6'" onmouseout="this.style.borderColor='transparent'"><div><div style="font-weight:bold; font-size:16px; color:#333d4b; margin-bottom:4px;">${escapeHtml(r.room_name)}</div><div style="font-size:12px; color:#8b95a1;">👥 ${r.members.length}명 | 🔑 코드: <span style="color:#3182f6; font-weight:bold;">${r.room_code}</span></div></div><div style="color:#3182f6; font-size:20px;">👉</div></div>`).join(''); }
        list.innerHTML = html;
    } else { 
        const room = myRooms.find(r => r.room_code === currentRoomCode); if (!room) { currentRoomCode = null; renderHome(); return; }
        
        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; background:#f2f4f6; padding:15px; border-radius:16px;"><button onclick="exitRoomView()" style="background:white; border:1px solid #e5e8eb; padding:8px 12px; border-radius:8px; font-size:14px; cursor:pointer; font-weight:bold; color:#4e5968;">🔙 로비로</button><div style="text-align:right;"><div style="font-weight:bold; color:#333d4b; font-size:16px;">${escapeHtml(room.room_name)}</div><div style="font-size:12px; color:#8b95a1;">초대 코드: <span style="color:#3182f6;">${room.room_code}</span></div></div></div>`;
        
        html += `<div style="background:#f9fafb; border-radius:16px; padding:15px; margin-bottom:20px; border:1px solid #eee;"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"><div style="font-size:14px; font-weight:bold; color:#333d4b;">💬 클럽 라운지 (채팅)</div><button onclick="refreshChat()" style="background:none; border:none; color:#3182f6; font-size:12px; cursor:pointer; font-weight:bold;">🔄 새로고침</button></div><div id="chat-box" style="height:150px; overflow-y:auto; background:white; padding:10px; border-radius:10px; margin-bottom:10px; border:1px solid #e5e8eb; font-size:13px; display:flex; flex-direction:column; gap:8px;">${room.messages && room.messages.length > 0 ? room.messages.map(m => { const isMe = m.sender_email === myEmail; return `<div style="text-align:${isMe ? 'right' : 'left'};"><span style="font-size:11px; color:#8b95a1; margin-right:5px;">${isMe?'':escapeHtml(m.sender_name)}</span><div style="display:inline-block; padding:8px 12px; border-radius:12px; background:${isMe ? '#3182f6' : '#f2f4f6'}; color:${isMe ? 'white' : '#333d4b'}; max-width:80%; word-break:break-all;">${escapeHtml(m.message)}</div></div>`; }).join('') : '<div style="text-align:center; color:#8b95a1; margin-top:50px;">채팅이 없습니다. 첫 인사를 남겨보세요!</div>'}</div><div style="display:flex; gap:8px;"><input id="chat-input" type="text" placeholder="메시지 입력..." style="flex:1; padding:10px; border:1px solid #e5e8eb; border-radius:8px; outline:none;" onkeypress="if(event.key==='Enter') sendChat()"><button onclick="sendChat()" style="background:#333d4b; color:white; border:none; padding:10px 15px; border-radius:8px; font-weight:bold; cursor:pointer;">전송</button></div></div>`;
        
        html += getCalendarHtml(room);

        html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;"><h3 style="color:#333d4b; margin:0; font-size:15px;">참여자 목록 (${room.members.length}명)</h3></div>`;
        
        html += room.members.map(f => { 
            const isMe = f.email === myEmail; 
            const isDelisted = f.status === 'delisted'; 
            const clickEvent = !isMe ? `onclick="openFriendDetail('${f.email}')"` : ""; 
            const cardStyle = isDelisted ? "background: #f2f2f2; opacity: 0.6; cursor:pointer;" : (isMe ? "background: #f0f8ff; border: 1px solid #cce5ff;" : "cursor: pointer; transition: 0.2s; box-shadow:0 2px 4px rgba(0,0,0,0.05);"); 
            
            const yPrice = getYesterdayClosePrice(f);
            const cAmt = f.price - yPrice;
            const cRate = yPrice > 0 ? ((cAmt / yPrice) * 100).toFixed(1) : 0;
            const cColor = cAmt > 0 ? '#ff3b30' : (cAmt < 0 ? '#3182f6' : '#8b95a1');
            const cSign = cAmt > 0 ? '+' : '';
            
            const priceHtml = isDelisted ? '-' : `${Math.floor(f.price || 0).toLocaleString()} p<br><span style="font-size:11px; color:${cColor}; font-weight:normal;">${cSign}${Math.floor(cAmt).toLocaleString()}p (${cSign}${cRate}%)</span>`;

            return `<div class="info-card" style="display: flex; justify-content: space-between; align-items: center; ${cardStyle}" ${clickEvent}><div style="display: flex; align-items: center; gap: 15px;">${getAvatarHtml(f, 'small')}<div><div style="font-size: 16px; font-weight: bold;"><span style="color: ${f.nameColor || '#333d4b'};">${escapeHtml(f.name)}</span> ${isMe ? '<span style="font-size:11px; background:#3182f6; color:white; padding:2px 6px; border-radius:4px; margin-left:4px;">나</span>' : ''} ${isDelisted ? '<span style="color:#ff3b30; font-size:12px; font-weight:bold; margin-left:4px;">💀상장폐지</span>' : ''}</div>${getBadgeHtml(f)}</div></div><div style="text-align: right; font-size: 16px; font-weight: bold; color: #333d4b;">${priceHtml}</div></div>`; 
        }).join('');
        
        html += `<button onclick="leaveCurrentRoom()" style="width:100%; margin-top:20px; padding:12px; background:white; color:#ff3b30; border:1px solid #ffdbdb; border-radius:12px; font-weight:bold; cursor:pointer;">🚪 이 클럽에서 나가기</button>`;
        list.innerHTML = html; 
        
        setTimeout(() => { const chatBox = document.getElementById('chat-box'); if(chatBox) chatBox.scrollTop = chatBox.scrollHeight; }, 10);
    }
}

function enterRoom(code) { 
    currentRoomCode = code; 
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    calSelectedDate = getFormattedDate(now);
    renderHome(); 
    forceSync(); 
}

function exitRoomView() { currentRoomCode = null; renderHome(); }

async function leaveCurrentRoom() { if(!confirm("정말 이 클럽에서 나가시겠습니까?")) return; try { const res = await fetch(`${BACKEND_URL}/api/room/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, room_code: currentRoomCode }) }); const data = await res.json(); if(data.status === 'success') { showToast("클럽에서 퇴장했습니다."); currentRoomCode = null; await forceSync(); } else { alert(data.message); } } catch(err) { alert("오류 발생"); } }
async function sendChat() { const input = document.getElementById('chat-input'); const text = input.value.trim(); if(!text || !currentRoomCode) return; input.value = ''; try { await fetch(`${BACKEND_URL}/api/room/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ room_code: currentRoomCode, sender_email: myEmail, sender_name: myProfile.name, message: text }) }); await forceSync(); } catch(err) { console.error(err); } }
async function refreshChat() { await forceSync(); }

function openFriendDetail(friendEmail) {
    const room = myRooms.find(r => r.room_code === currentRoomCode); const friend = room.members.find(m => m.email === friendEmail); if (!friend) return;
    currentSelectedFriend = friend;
    
    if (friend.status === 'delisted') { alert(`💀 상장폐지된 코인은 더 이상 평가할 수 없습니다.`); return; }

    let modal = document.getElementById('eval-modal');
    if(!modal) { modal = document.createElement('div'); modal.id = 'eval-modal'; modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; display:none; justify-content:center; align-items:center;"; document.body.appendChild(modal); }
    
    evalState.p1 = Math.floor(friend.price * 0.01); 
    evalState.p2 = Math.floor(friend.price * 0.02); 
    evalState.p3 = Math.floor(friend.price * 0.03);
    evalState.type = null; 
    evalState.intensity = null;

    const yPrice = getYesterdayClosePrice(friend);
    const cAmt = friend.price - yPrice;
    const cRate = yPrice > 0 ? ((cAmt / yPrice) * 100).toFixed(1) : 0;
    const cColor = cAmt > 0 ? '#ff3b30' : (cAmt < 0 ? '#3182f6' : '#8b95a1');
    const cSign = cAmt > 0 ? '+' : '';

    modal.innerHTML = `
        <div style="background:white; padding:30px 25px; border-radius:20px; width:85%; max-width:340px; text-align:center; box-shadow: 0 10px 25px rgba(0,0,0,0.2); max-height:90vh; overflow-y:auto;">
            <div style="margin-bottom:15px;">${getAvatarHtml(friend, 'large')}</div>
            <h2 style="margin:0 0 5px 0; color:${friend.nameColor || '#333d4b'};">${escapeHtml(friend.name)}</h2>
            <div style="font-size:26px; font-weight:bold; color:#333d4b; margin-bottom:5px;">${Math.floor(friend.price).toLocaleString()} p</div>
            <div style="font-size:14px; font-weight:bold; color:${cColor}; margin-bottom:15px;">${cSign}${Math.floor(cAmt).toLocaleString()} p (${cSign}${cRate}%)</div>
            <div style="background: #ffffff; padding: 10px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #e5e8eb;"><canvas id="friendFriendChartCanvas" style="width:100%; height:110px;"></canvas></div>
            <div style="background:#f9fafb; padding:10px; border-radius:10px; font-size:12px; color:#8b95a1; margin-bottom:20px;">티켓은 무조건 1장 소모됩니다.<br>내 평가권: 👍 <b>${myProfile.goodTickets}장</b> | 👎 <b>${myProfile.badTickets}장</b></div>
            
            <div style="text-align:left; margin-bottom:15px;">
                <div style="font-weight:bold; margin-bottom:8px; font-size:13px; color:#4e5968;">1. 평가 종류 선택</div>
                <div style="display:flex; gap:10px;">
                    <button id="eval-type-good" onclick="selectEvalType('good')" style="flex:1; padding:12px; border:1px solid #ffdbdb; background:white; color:#ff3b30; border-radius:10px; font-weight:bold; cursor:pointer; transition:0.2s;">👍 호평하기</button>
                    <button id="eval-type-bad" onclick="selectEvalType('bad')" style="flex:1; padding:12px; border:1px solid #d6ebff; background:white; color:#3182f6; border-radius:10px; font-weight:bold; cursor:pointer; transition:0.2s;">👎 악평하기</button>
                </div>
            </div>

            <div id="eval-intensity-section" style="text-align:left; margin-bottom:15px; display:none;">
                <div style="font-weight:bold; margin-bottom:8px; font-size:13px; color:#4e5968;">2. 변동폭 선택</div>
                <div style="display:flex; gap:8px;">
                    <button id="eval-int-1" onclick="selectEvalIntensity(1)" style="flex:1; padding:10px; border:1px solid #e5e8eb; background:white; border-radius:8px; font-weight:bold; cursor:pointer; transition:0.2s;"><span id="eval-int-1-pct">1%</span><br><span id="eval-int-1-pts" style="font-size:10px; font-weight:normal; color:#8b95a1;"></span></button>
                    <button id="eval-int-2" onclick="selectEvalIntensity(2)" style="flex:1; padding:10px; border:1px solid #e5e8eb; background:white; border-radius:8px; font-weight:bold; cursor:pointer; transition:0.2s;"><span id="eval-int-2-pct">2%</span><br><span id="eval-int-2-pts" style="font-size:10px; font-weight:normal; color:#8b95a1;"></span></button>
                    <button id="eval-int-3" onclick="selectEvalIntensity(3)" style="flex:1; padding:10px; border:1px solid #e5e8eb; background:white; border-radius:8px; font-weight:bold; cursor:pointer; transition:0.2s;"><span id="eval-int-3-pct">3%</span><br><span id="eval-int-3-pts" style="font-size:10px; font-weight:normal; color:#8b95a1;"></span></button>
                </div>
            </div>

            <div style="text-align:left; margin-bottom:20px;">
                <div style="font-weight:bold; margin-bottom:8px; font-size:13px; color:#4e5968;">3. 사유 작성</div>
                <textarea id="eval-reason-input" placeholder="이 코인을 평가하는 사유를 적어주세요 (필수)" style="width:100%; height:60px; padding:10px; border:1px solid #e5e8eb; border-radius:8px; box-sizing:border-box; resize:none; font-family:sans-serif; outline:none; font-size:13px;"></textarea>
            </div>

            <button onclick="submitEvaluationFinal()" style="width:100%; padding:15px; background:#333d4b; color:white; border:none; border-radius:12px; font-weight:bold; font-size:15px; cursor:pointer; margin-bottom:10px; transition:0.2s;">🚀 평가 보내기</button>
            <button onclick="document.getElementById('eval-modal').style.display='none'" style="width:100%; padding:12px; background:#f2f4f6; color:#8b95a1; border:none; border-radius:12px; font-weight:bold; cursor:pointer; font-size:14px;">취소</button>
        </div>
    `;
    modal.style.display = 'flex'; setTimeout(() => drawFriendPriceChart(friend), 50);
}

function selectEvalType(type) {
    evalState.type = type; evalState.intensity = null;
    const goodBtn = document.getElementById('eval-type-good'); const badBtn = document.getElementById('eval-type-bad'); const intSec = document.getElementById('eval-intensity-section');
    goodBtn.style.background = 'white'; goodBtn.style.color = '#ff3b30'; badBtn.style.background = 'white'; badBtn.style.color = '#3182f6';
    if (type === 'good') {
        goodBtn.style.background = '#ff3b30'; goodBtn.style.color = 'white';
        document.getElementById('eval-int-1-pct').textContent = '+1%'; document.getElementById('eval-int-2-pct').textContent = '+2%'; document.getElementById('eval-int-3-pct').textContent = '+3%';
        document.getElementById('eval-int-1-pts').textContent = `+${evalState.p1.toLocaleString()}p`; document.getElementById('eval-int-2-pts').textContent = `+${evalState.p2.toLocaleString()}p`; document.getElementById('eval-int-3-pts').textContent = `+${evalState.p3.toLocaleString()}p`;
    } else {
        badBtn.style.background = '#3182f6'; badBtn.style.color = 'white';
        document.getElementById('eval-int-1-pct').textContent = '-1%'; document.getElementById('eval-int-2-pct').textContent = '-2%'; document.getElementById('eval-int-3-pct').textContent = '-3%';
        document.getElementById('eval-int-1-pts').textContent = `-${evalState.p1.toLocaleString()}p`; document.getElementById('eval-int-2-pts').textContent = `-${evalState.p2.toLocaleString()}p`; document.getElementById('eval-int-3-pts').textContent = `-${evalState.p3.toLocaleString()}p`;
    }
    intSec.style.display = 'block';
    [1, 2, 3].forEach(i => { const btn = document.getElementById(`eval-int-${i}`); btn.style.background = 'white'; btn.style.color = '#333d4b'; btn.style.borderColor = '#e5e8eb'; });
}

function selectEvalIntensity(intensity) {
    evalState.intensity = intensity;
    const color = evalState.type === 'good' ? '#ff3b30' : '#3182f6'; const bgColor = evalState.type === 'good' ? '#fff2f2' : '#f0f8ff';
    [1, 2, 3].forEach(i => { const btn = document.getElementById(`eval-int-${i}`); if (i === intensity) { btn.style.background = bgColor; btn.style.color = color; btn.style.borderColor = color; } else { btn.style.background = 'white'; btn.style.color = '#333d4b'; btn.style.borderColor = '#e5e8eb'; } });
}

function submitEvaluationFinal() {
    if (!evalState.type) { alert("평가 종류(호평/악평)를 선택해주세요."); return; }
    if (!evalState.intensity) { alert("변동폭(1%, 2%, 3%)을 선택해주세요."); return; }
    submitEvaluation(evalState.type, evalState.intensity);
}

async function submitEvaluation(evalType, intensity) {
    if (!currentSelectedFriend) return;
    if (evalType === 'good' && myProfile.goodTickets <= 0) { alert("남은 호평권이 없습니다!"); return; }
    if (evalType === 'bad' && myProfile.badTickets <= 0) { alert("남은 악평권이 없습니다!"); return; }
    const reasonInput = document.getElementById('eval-reason-input'); const reasonText = reasonInput ? reasonInput.value.trim() : "";
    if (!reasonText) { alert("평가 사유를 반드시 작성해 주세요!"); if(reasonInput) reasonInput.focus(); return; }
    document.getElementById('eval-modal').style.display = 'none'; showToast(`⏳ 반영 중...`);
    try {
        const res = await fetch(`${BACKEND_URL}/api/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ evaluator_email: myEmail, target_email: currentSelectedFriend.email, eval_type: evalType, intensity: intensity, reason: reasonText }) });
        const data = await res.json(); if (data.status === 'success') { alert(data.message); await forceSync(); } else { alert(data.message); }
    } catch(err) { alert("네트워크 오류 발생"); }
}

function renderMeeting() {
    const list = document.getElementById('meeting-list'); if(!list) return;
    
    let allAgendas = [];
    myRooms.forEach(room => {
        if (room.agendas) {
            room.agendas.forEach(a => {
                allAgendas.push({ 
                    ...a, 
                    room_name: room.room_name, 
                    room_code: room.room_code, 
                    totalMembers: room.members.length, 
                    members: room.members 
                });
            });
        }
    });

    if (allAgendas.length === 0) { 
        list.innerHTML = `<div style="text-align:center; padding:50px 20px; color:#8b95a1; background:#f9fafb; border-radius:16px;">🕊️ 현재 진행 중이거나 최근 종료된 재판이 없습니다.</div>`; 
        return; 
    }

    const actives = allAgendas.filter(a => a.status === 'active').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const closed = allAgendas.filter(a => a.status !== 'active').sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10); 
    
    const displayAgendas = [...actives, ...closed];

    list.innerHTML = `<div style="display:flex; justify-content:flex-end; margin-bottom:10px;"><button onclick="forceSync()" style="background:none; border:none; color:#3182f6; font-size:12px; cursor:pointer; font-weight:bold;">🔄 새로고침</button></div>` + 
    displayAgendas.map(a => {
        let titleColor = '#ff3b30'; let titleText = '🚨 상장폐지 심사 법정'; 
        if (a.type === 'revival') { titleColor = '#2e7d32'; titleText = '🌱 코인 회생 재상장 건'; } 
        else if (a.type === 'defense') { titleColor = '#f39c12'; titleText = '⚖️ 악평 이의제기 방어 법정'; }
        
        const targetPerson = a.members.find(f => f.email === a.target_email); 
        const avatarHtml = targetPerson ? getAvatarHtml(targetPerson, 'small') : ''; 
        const hasVoted = a.votedUsers && a.votedUsers.includes(myEmail);
        
        const totalMembers = a.totalMembers;
        const requiredVotes = Math.floor(totalMembers / 2) + 1;
        const agreePct = Math.min((a.agreeVotes / totalMembers) * 100, 100);
        const disagreePct = Math.min((a.disagreeVotes / totalMembers) * 100, 100);
        const requiredPct = (requiredVotes / totalMembers) * 100;

        const gaugeHtml = `
            <div style="position:relative; width:100%; height:14px; background:#e5e8eb; border-radius:7px; margin:15px 0; overflow:hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
                <div style="position:absolute; left:0; top:0; height:100%; width:${agreePct}%; background:${titleColor}; transition:width 0.8s ease-out;"></div>
                <div style="position:absolute; right:0; top:0; height:100%; width:${disagreePct}%; background:#3182f6; transition:width 0.8s ease-out;"></div>
                <div style="position:absolute; left:${requiredPct}%; top:0; height:100%; width:3px; background:#333d4b; z-index:5;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:bold; margin-top:-10px; margin-bottom:15px;">
                <span style="color:${titleColor};">찬성 ${a.agreeVotes}표</span>
                <span style="color:#333d4b;">정족수 ${requiredVotes}표</span>
                <span style="color:#3182f6;">반대 ${a.disagreeVotes}표</span>
            </div>
        `;

        let btnHtml = ''; let stampHtml = ''; let opacityStyle = ''; let timeRemainingHtml = '';

        if (a.status === 'active') {
            const createdTime = new Date(a.created_at).getTime();
            const expireTime = createdTime + (24 * 60 * 60 * 1000);
            const nowTime = new Date().getTime();
            let diffMs = expireTime - nowTime;
            if (diffMs < 0) diffMs = 0;
            const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
            const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            
            timeRemainingHtml = `<span style="background:#fff3f3; color:#ff3b30; padding:3px 8px; border-radius:10px; font-size:11px; font-weight:bold;">⏳ 마감까지 ${diffHrs}시간 ${diffMins}분</span>`;

            btnHtml = hasVoted ? 
                `<button style="width:100%; background:#e5e8eb; color:#8b95a1; border:none; padding:12px; border-radius:10px; font-weight:bold; cursor:not-allowed;" disabled>⚖️ 투표 완료</button>` : 
                `<button class="btn-vote-disagree" style="flex:1; background:#f2f4f6; color:#3182f6; border:1px solid #d6ebff; font-weight:bold; padding:12px; border-radius:10px; cursor:pointer;" onclick="submitVote('${a.room_code}', '${a.id}', 'disagree')">반대 (기각)</button>
                 <button class="btn-vote-agree" style="flex:1; background:${titleColor}; color:white; border:none; font-weight:bold; padding:12px; border-radius:10px; cursor:pointer;" onclick="submitVote('${a.room_code}', '${a.id}', 'agree')">찬성 (판결)</button>`;
        } else {
            opacityStyle = 'opacity: 0.65; filter: grayscale(20%);';
            const isResolved = a.status === 'resolved';
            const stampColor = isResolved ? titleColor : '#3182f6';
            const stampText = isResolved ? '가결 확정' : '기각 무효';
            stampHtml = `<div class="verdict-stamp" style="border-color:${stampColor}; color:${stampColor};">${stampText}</div>`;
            btnHtml = `<div style="width:100%; text-align:center; padding:10px; font-size:13px; font-weight:bold; color:#8b95a1; background:#f9fafb; border-radius:10px;">종료된 재판 기록입니다.</div>`;
        }

        // ★ [패치] 클릭 시 해당 방으로 전환하며, 탭(화면) 자체를 '목록(로비)' 탭으로 착! 바꿔버리도록 수정!
        return `
        <div class="info-card" style="border-left: 5px solid ${titleColor}; position:relative; overflow:hidden; ${opacityStyle}; cursor:pointer;" onclick="enterRoom('${a.room_code}'); switchTab('home');">
            ${stampHtml}
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="background:#f2f4f6; color:#4e5968; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:bold;">🏢 ${escapeHtml(a.room_name)}</span>
                ${timeRemainingHtml}
            </div>
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                ${avatarHtml}
                <div>
                    <div style="color: ${titleColor}; font-weight: bold; font-size:15px;">[${titleText}]</div>
                    <div style="font-size:13px; color:#333d4b;">피고인: <b>${escapeHtml(a.target_name)}</b></div>
                </div>
            </div>
            <div style="background:#f9fafb; padding:12px; border-radius:10px; font-size:14px; color:#4e5968; line-height:1.5; margin-bottom:12px; border:1px dashed #e5e8eb;">
                <b>📝 재판 안건 사유:</b><br>${escapeHtml(a.reason)}
            </div>
            ${gaugeHtml}
            <div style="display: flex; gap: 10px;">${btnHtml}</div>
        </div>`;
    }).join('');
}

async function submitVote(roomCode, agendaId, voteType) { 
    event.stopPropagation(); 
    showToast("⏳ 표결 전달 중..."); 
    try { 
        const res = await fetch(`${BACKEND_URL}/api/agenda/vote`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, 
            body: JSON.stringify({ room_code: roomCode, agenda_id: agendaId, voter_email: myEmail, vote_type: voteType }) 
        }); 
        const data = await res.json(); 
        if (data.status === 'resolved') { alert(`⚖️ [최종 판결]\n${data.message}`); await forceSync(); switchTab('meeting'); } 
        else if (data.status === 'success') { showToast("📥 투표 완료"); await forceSync(); switchTab('meeting'); } 
        else { alert(data.message); } 
    } catch(err) { alert("네트워크 오류"); } 
}

async function createNewRoom() { const name = prompt("새 투자 클럽 이름을 입력하세요:"); if(!name || name.trim() === "") return; try { const res = await fetch(`${BACKEND_URL}/api/room/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, room_name: name.trim() }) }); const data = await res.json(); if(data.status === 'success') { alert(`🎉 클럽 생성 완료!\n초대 코드: [ ${data.room_code} ]`); await forceSync(); } } catch(err) { alert("서버 오류"); } }
async function joinExistingRoom() { const code = prompt("초대 코드를 입력하세요:"); if(!code || code.trim() === "") return; try { const res = await fetch(`${BACKEND_URL}/api/room/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, room_code: code.trim().toUpperCase() }) }); const data = await res.json(); if(data.status === 'error') { alert(data.message); return; } alert(`🚪 입장 성공!`); await forceSync(); } catch(err) { alert("서버 오류"); } }

function renderRanking() {
    const container = document.getElementById('ranking-content'); if (!container || !myProfile || globalRanking.length === 0) return;
    const top10 = globalRanking.slice(0, 10);
    const createTotalRankCard = (p, index) => {
        const medals = ['🥇', '🥈', '🥉']; const rankIcon = index < 3 ? medals[index] : `<span style="display:inline-block; width: 24px; text-align:center; color:#8b95a1; font-size:14px; font-weight:bold;">${index+1}</span>`;
        const isMe = p.name === myProfile.name; const bg = isMe ? "background:#f0f8ff;" : "";
        
        const yPrice = getYesterdayClosePrice(p);
        const cAmt = p.price - yPrice;
        const cRate = yPrice > 0 ? ((cAmt / yPrice) * 100).toFixed(1) : 0;
        const cColor = cAmt > 0 ? '#ff3b30' : (cAmt < 0 ? '#3182f6' : '#8b95a1');
        const cSign = cAmt > 0 ? '+' : '';
        
        return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 10px; border-bottom: 1px solid #f9fafb; border-radius:8px; ${bg}"><div style="display: flex; align-items: center; font-size: 15px; font-weight: bold;"><span style="font-size: 18px; margin-right: 10px; width:20px; text-align:center;">${rankIcon}</span>${getAvatarHtml(p, 'small')}<span style="margin-left:10px; color: ${p.nameColor || '#333d4b'};">${escapeHtml(p.name)}</span> ${isMe ? '<span style="font-size:11px; background:#3182f6; color:white; padding:2px 6px; border-radius:4px; margin-left:4px;">나</span>' : ''}</div><div style="text-align: right; font-weight: bold; color: #333d4b;">${Math.floor(p.price||0).toLocaleString()} p<br><span style="font-size:10px; color:${cColor}; font-weight:normal;">${cSign}${Math.floor(cAmt).toLocaleString()} (${cSign}${cRate}%)</span></div></div>`;
    };
    container.innerHTML = `<div style="background: white; border-radius: 16px; padding: 20px 15px; margin-bottom: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #eee;"><h3 style="margin-top: 0; color: #333d4b;">🌍 전국구 통합 랭킹 Top 10</h3><p style="font-size:12px; color:#8b95a1; margin-bottom:20px;">모든 클럽의 주가가 합산된 실시간 순위보드입니다.</p>${top10.map((p, i) => createTotalRankCard(p, i)).join('')}</div>`;
}

async function doDailyAttendance() { 
    showToast("⏳ 출석 처리 중...");
    try {
        const res = await fetch(`${BACKEND_URL}/api/reward`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, reward_type: 'attendance' }) });
        const data = await res.json(); if(data.status === 'success') { myProfile = data.profile; showToast(data.message); saveData(); renderProfile(); } else { showToast(data.message); }
    } catch(err) { alert("서버 오류"); }
}

function watchAd(type) {
    currentAdRewardType = type; if (myProfile.isVIP) { claimAdReward(true); return; }
    document.getElementById('ad-modal').style.display = 'flex'; let timeLeft = 3; document.getElementById('ad-timer').textContent = `광고 준비 중... (${timeLeft}초)`;
    const btn = document.getElementById('ad-close-btn'); btn.textContent = "광고를 끝까지 시청해주세요"; btn.style.background = "#e5e8eb"; btn.style.color = "#8b95a1"; btn.disabled = true; btn.onclick = null;
    adInterval = setInterval(() => { timeLeft--; if (timeLeft > 0) { document.getElementById('ad-timer').textContent = `광고 시청 중... (${timeLeft}초)`; } else { clearInterval(adInterval); document.getElementById('ad-timer').textContent = "✅ 시청 완료!"; btn.textContent = "보상 받기 🎁"; btn.style.background = "#3182f6"; btn.style.color = "white"; btn.disabled = false; btn.onclick = () => claimAdReward(false); } }, 1000);
}

async function claimAdReward(isVipPass = false) { 
    document.getElementById('ad-modal').style.display = 'none'; showToast("⏳ 보상 수령 중...");
    try {
        const res = await fetch(`${BACKEND_URL}/api/reward`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, reward_type: currentAdRewardType }) });
        const data = await res.json(); if(data.status === 'success') { myProfile = data.profile; showToast(isVipPass ? `👑 VIP 프리패스! ${data.message}` : data.message); saveData(); renderProfile(); } else { showToast(data.message); }
    } catch(err) { alert("서버 오류"); }
}

async function claimWeeklyTickets() { 
    showToast("⏳ 처리 중...");
    try {
        const res = await fetch(`${BACKEND_URL}/api/reward`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, reward_type: 'weekly' }) });
        const data = await res.json(); if(data.status === 'success') { myProfile = data.profile; showToast(data.message); saveData(); renderProfile(); } else { showToast(data.message); }
    } catch(err) { alert("서버 오류"); }
}

function openVIPModal() { document.getElementById('vip-modal').style.display = 'flex'; if (myProfile.isVIP) { document.getElementById('vip-buy-section').style.display = 'none'; document.getElementById('vip-manage-section').style.display = 'block'; document.getElementById('vip-color-picker').value = myProfile.nameColor || '#333d4b'; } else { document.getElementById('vip-buy-section').style.display = 'block'; document.getElementById('vip-manage-section').style.none; } }
function closeVIPModal() { document.getElementById('vip-modal').style.display = 'none'; }
function buyVIP() { myProfile.isVIP = true; myProfile.nameColor = '#d4af37'; saveData(); showToast("💎 VIP 멤버십 가입 완료!"); openVIPModal(); renderProfile(); }
function applyVIPColor() { const color = document.getElementById('vip-color-picker').value; myProfile.nameColor = color; saveData(); showToast("🎨 색상 변경!"); closeVIPModal(); renderProfile(); }

function renderProfile() {
    const container = document.getElementById('my-profile-info'); if(!container || !myProfile) return;
    const isDelisted = myProfile.status === 'delisted'; 
    
    const yesterdayPrice = getYesterdayClosePrice(myProfile);
    const changeAmount = myProfile.price - yesterdayPrice; 
    const changeRate = yesterdayPrice > 0 ? ((changeAmount / yesterdayPrice) * 100).toFixed(1) : 0;
    const colorClass = changeAmount > 0 ? '#ff3b30' : (changeAmount < 0 ? '#3182f6' : '#8b95a1'); 
    const sign = changeAmount > 0 ? '+' : '';
    
    const vipBanner = myProfile.isVIP ? `<div style="background: linear-gradient(135deg, #d4af37, #f3e5f5); padding: 15px; border-radius: 12px; color: white; font-weight: bold; cursor: pointer; margin-bottom: 20px; text-align: left; display: flex; justify-content: space-between; align-items: center;" onclick="openVIPModal()"><div style="color:#333d4b;">👑 VIP 멤버십 적용 중</div><div style="font-size: 12px; background: rgba(255,255,255,0.4); color: #333d4b; padding: 6px 10px; border-radius: 6px;">설정 ⚙️</div></div>` : `<div style="background: #333d4b; padding: 15px; border-radius: 12px; color: #d4af37; font-weight: bold; cursor: pointer; margin-bottom: 20px; text-align: left; display: flex; justify-content: space-between; align-items: center;" onclick="openVIPModal()"><div>💎 프리미엄 가입하기</div><div style="font-size: 12px; background: rgba(255,255,255,0.1); padding: 6px 10px; border-radius: 6px; color:white;">알아보기 👉</div></div>`;
    const todayStr = getFormattedDate(new Date()); 
    const hasDailyDone = myProfile.lastDailyAttendance === todayStr;
    const dailyBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: ${hasDailyDone ? '#e5e8eb' : '#e8f5e9'}; color: ${hasDailyDone ? '#8b95a1' : '#2e7d32'}; font-weight: bold; border: none; cursor: ${hasDailyDone ? 'not-allowed' : 'pointer'}; margin-bottom: 10px;" onclick="doDailyAttendance()" ${hasDailyDone ? 'disabled' : ''}>${hasDailyDone ? '✅ 출석 완료' : '📅 매일 출석 (+50p)'}</button>`;
    
    const hasAdBonusDone = myProfile.lastDailyAdBonus === todayStr; 
    let adDoubleBtn = ''; 
    if (hasDailyDone && !hasAdBonusDone) { 
        adDoubleBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: #e3f2fd; color: #1565c0; font-weight: bold; border: none; cursor: pointer; margin-bottom: 10px;" onclick="watchAd('double_attendance')">🎬 광고 보고 2배 출석 (+50p)</button>`; 
    } else if (hasDailyDone && hasAdBonusDone) { 
        adDoubleBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: #e5e8eb; color: #8b95a1; font-weight: bold; border: none; cursor: not-allowed; margin-bottom: 10px;" disabled>✅ 출석 보상 2배 완료</button>`; 
    }
    
    const hasWeeklyDone = myProfile.weeklyTicketsClaimed === true; 
    const weeklyBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: ${hasWeeklyDone ? '#e5e8eb' : '#fff3e0'}; color: ${hasWeeklyDone ? '#8b95a1' : '#e65100'}; font-weight: bold; border: none; cursor: ${hasWeeklyDone ? 'not-allowed' : 'pointer'}; margin-bottom: 10px;" onclick="claimWeeklyTickets()" ${hasWeeklyDone ? 'disabled' : ''}>${hasWeeklyDone ? '✅ 주간 보너스 완료' : '🎁 주간 보너스 평가권 (각 +1장)'}</button>`;
    
    if (myProfile.dailyAdTicketsDate !== todayStr) myProfile.dailyAdTicketsCount = 0; 
    const adTicketCount = myProfile.dailyAdTicketsCount || 0; 
    const isAdTicketMax = adTicketCount >= 1;
    const adTicketBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: ${isAdTicketMax ? '#e5e8eb' : '#f3e5f5'}; color: ${isAdTicketMax ? '#8b95a1' : '#6a1b9a'}; font-weight: bold; border: none; cursor: ${isAdTicketMax ? 'not-allowed' : 'pointer'}; margin-bottom: 10px;" onclick="watchAd('extra_ticket')" ${isAdTicketMax ? 'disabled' : ''}>${isAdTicketMax ? '✅ 오늘 티켓 추가 완료' : `🎬 광고 보고 평가권 추가 (${adTicketCount}/1회)`}</button>`;

    let actionBtn = `${dailyBtn}${adDoubleBtn}${weeklyBtn}${adTicketBtn}`;
    if (isDelisted) { actionBtn = `<div style="background:#ffebee; color:#c62828; padding:15px; border-radius:12px; font-weight:bold; text-align:center; font-size:14px; margin-bottom:15px;">💀 코인이 상장폐지 상태입니다. 시스템의 구제 재판을 기다리세요.</div>`; }

    container.innerHTML = `
        ${vipBanner}
        <div style="position: relative; display: inline-block;">${getAvatarHtml(myProfile, 'large')}<button onclick="openProfileModal()" style="position: absolute; bottom: 0; right: -10px; background: #3182f6; color: white; border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 14px; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">✏️</button></div>
        <h2 style="margin: 10px 0; color: ${myProfile.nameColor || '#333d4b'}; display:flex; justify-content:center; align-items:center; gap:8px;">${escapeHtml(myProfile.name)} 코인 <span onclick="changeNickname()" style="font-size:14px; color:#8b95a1; background:#f2f4f6; padding:4px 8px; border-radius:6px; cursor:pointer;">변경</span></h2>
        <div style="font-size:12px; color:#8b95a1; margin-bottom:10px;">내 주가는 모든 클럽에 적용됩니다.</div>
        ${getBadgeHtml(myProfile)}
        <div style="display: flex; justify-content: space-around; margin: 20px 0;">
            <div style="background: #f9fafb; padding: 15px; border-radius: 12px; width: 40%;"><div style="font-size: 13px; color: #8b95a1;">남은 호평권 👍</div><div style="font-size: 20px; font-weight: bold; color: #ff3b30;">${myProfile.goodTickets} 장</div></div>
            <div style="background: #f9fafb; padding: 15px; border-radius: 12px; width: 40%;"><div style="font-size: 13px; color: #8b95a1;">남은 악평권 👎</div><div style="font-size: 20px; font-weight: bold; color: #3182f6;">${myProfile.badTickets} 장</div></div>
        </div>
        <div style="font-size: 32px; font-weight: bold; color: #333d4b; margin-top: 20px;">${isDelisted ? '💀' : Math.floor(myProfile.price).toLocaleString()} p</div>
        <div style="font-weight: bold; color: ${colorClass}; margin-bottom: 20px;">${isDelisted ? '' : sign + Math.floor(changeAmount).toLocaleString() + ' p (' + sign + changeRate + '%)'}</div>
        <div style="background: white; padding: 15px; border-radius: 16px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.03); border: 1px solid #f2f4f6;"><canvas id="priceChart" style="width:100%; height:150px;"></canvas></div>
        ${actionBtn}
        <button style="width: 100%; padding: 12px; border-radius: 12px; background: #ffebee; color: #c62828; font-weight: bold; border: none; cursor: pointer; margin-top: 20px; margin-bottom: 100px;" onclick="handleLogout()">🚪 로그아웃</button>
    `;
    setTimeout(drawPriceChart, 50); 
}

function openProfileModal() { document.getElementById('profile-modal').style.display = 'flex'; const grid = document.getElementById('default-profiles-grid'); grid.innerHTML = DEFAULT_AVATARS.map(url => `<div onclick="selectDefaultProfile('${url}')" style="cursor: pointer; border-radius: 12px; overflow: hidden; background: #f2f4f6; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: transform 0.1s;"><img src="${url}" style="width: 100%; height: 100%; display: block; object-fit: cover;"></div>`).join(''); }
function closeProfileModal() { document.getElementById('profile-modal').style.display = 'none'; }
function selectDefaultProfile(url) { myProfile.profileImage = url; saveData(); showToast("프로필 이미지 변경!"); closeProfileModal(); renderProfile(); }
async function changeNickname() { const newName = prompt("변경할 닉네임 (최대 8자):"); if(!newName || newName.trim() === "" || newName.trim() === myProfile.name) return; if (/[^a-zA-Z0-9가-힣]/.test(newName.trim())) { alert("특수문자 불가"); return; } try { const res = await fetch(`${BACKEND_URL}/api/check-nickname?nickname=${encodeURIComponent(newName.trim())}`); const data = await res.json(); if(!data.available) { alert(data.message); return; } myProfile.name = newName.trim(); myUsername = myProfile.name; localStorage.setItem('fc_username', myUsername); saveData(); showToast("변경 완료!"); renderProfile(); } catch(err) { alert("오류 발생"); } }

let fileInput = document.getElementById('custom-image-upload');
if(fileInput) { fileInput.addEventListener('change', async function(e) { const file = e.target.files[0]; if(!file) return; const formData = new FormData(); formData.append("image", file); try { const response = await fetch(`${BACKEND_URL}/api/upload`, { method: "POST", body: formData }); const data = await response.json(); if (data.url) { myProfile.profileImage = data.url; saveData(); showToast("📸 업로드 완료!"); closeProfileModal(); renderProfile(); } else { showToast("🚨 업로드 실패"); } } catch(err) { showToast("🚨 네트워크 오류"); } }); }

function decodeJwtResponse(token) { let base64Url = token.split('.')[1]; let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(decodeURIComponent(atob(base64).split('').map(function(c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join(''))); }
function showLoginScreen() {
    let loginDiv = document.getElementById('login-overlay'); if (!loginDiv) { loginDiv = document.createElement('div'); loginDiv.id = 'login-overlay'; loginDiv.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:#f2f4f6; z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;"; document.body.appendChild(loginDiv); }
    loginDiv.innerHTML = `<div style="background:white; padding:40px 30px; border-radius:20px; box-shadow:0 10px 20px rgba(0,0,0,0.1); text-align:center; width:80%; max-width:350px;"><div style="font-size:50px; margin-bottom:15px; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;">💰</div><h1 style="margin:0 0 10px 0; color:#333d4b; font-size:24px;">친구 코인 접속</h1><button onclick="triggerGoogleIntent('login')" style="width:100%; padding:15px; background:#333d4b; color:white; border:none; border-radius:12px; font-size:16px; font-weight:bold; cursor:pointer; margin-bottom:10px;">기존 계정으로 로그인</button><button onclick="triggerGoogleIntent('signup')" style="width:100%; padding:15px; background:#e8f5e9; color:#2e7d32; border:none; border-radius:12px; font-size:16px; font-weight:bold; cursor:pointer; margin-bottom:25px;">새로 시작하기 (회원가입)</button><div id="google-btn-container" style="display:none; justify-content:center;"></div></div>`;
    if (!document.getElementById('google-jssdk')) { const script = document.createElement('script'); script.id = 'google-jssdk'; script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.defer = true; script.onload = () => { google.accounts.id.initialize({ client_id: "837250448431-hrlfbnof2bf4acofs03e28t3qdpkun5g.apps.googleusercontent.com", callback: handleCredentialResponse }); google.accounts.id.renderButton(document.getElementById("google-btn-container"), { theme: "outline", size: "large", shape: "pill" }); }; document.head.appendChild(script); } 
    else { google.accounts.id.initialize({ client_id: "837250448431-hrlfbnof2bf4acofs03e28t3qdpkun5g.apps.googleusercontent.com", callback: handleCredentialResponse }); google.accounts.id.renderButton(document.getElementById("google-btn-container"), { theme: "outline", size: "large", shape: "pill" }); }
}
function triggerGoogleIntent(intent) { loginIntent = intent; document.getElementById('google-btn-container').style.display = 'flex'; }

async function handleCredentialResponse(response) {
    const responsePayload = decodeJwtResponse(response.credential); const tempEmail = responsePayload.email; const idToken = response.credential;
    localStorage.setItem('fc_id_token', idToken); localStorage.setItem('fc_email', tempEmail);
    const overlay = document.getElementById('login-overlay'); if(overlay) overlay.innerHTML = `<div style="font-size:20px; font-weight:bold; color:#333d4b;">서버 연결 중... ⏳</div>`; 
    try {
        const serverResponse = await fetch(`${BACKEND_URL}/api/data?t=${new Date().getTime()}`, { headers: { "Authorization": `Bearer ${idToken}`, "Cache-Control": "no-cache" } }); 
        const serverData = await serverResponse.json();
        if (loginIntent === 'login' && serverData.isNewUser) { alert("가입 정보가 없습니다. 새로 시작하기를 이용해 주세요."); localStorage.clear(); location.reload(); return; }
        myEmail = tempEmail;
        if (serverData.isNewUser) { showNicknameSetupScreen(responsePayload.picture); } 
        else { myProfile = serverData.profile; myUsername = myProfile.name; localStorage.setItem('fc_username', myUsername); myNotifications = serverData.noti || []; myRooms = serverData.my_rooms || []; globalRanking = serverData.global_ranking || []; if(overlay) overlay.remove(); finishSetup(); }
    } catch(err) { alert("연결 실패"); localStorage.clear(); location.reload(); }
}
function handleLogout() { localStorage.clear(); location.reload(); }
function showNicknameSetupScreen(googlePicture) { let overlay = document.getElementById('login-overlay'); overlay.innerHTML = `<div style="background:white; padding:40px 30px; border-radius:20px; text-align:center; width:80%; max-width:350px;"><div style="font-size:40px; margin-bottom:15px;">👋</div><h1 style="margin:0; font-size:22px;">닉네임 설정</h1><input type="text" id="new-nickname-input" placeholder="닉네임" style="width:100%; padding:15px; border:1px solid #e5e8eb; border-radius:12px; text-align:center; margin:15px 0 10px 0;"><p id="nickname-error" style="color:#ff3b30; font-size:12px; margin-bottom:20px; height:15px;"></p><button onclick="submitNewNickname('${googlePicture || ''}')" style="width:100%; padding:15px; background:#3182f6; color:white; border:none; border-radius:12px; font-weight:bold; cursor:pointer;">시작하기 🚀</button></div>`; }
async function submitNewNickname(googlePicture) { const inputEl = document.getElementById('new-nickname-input'); const errorEl = document.getElementById('nickname-error'); const newName = inputEl.value.trim(); if(!newName) { errorEl.textContent = "닉네임을 입력하세요."; return; } if (/[^a-zA-Z0-9가-힣]/.test(newName)) { errorEl.textContent = "특수문자 금지"; return; } try { const res = await fetch(`${BACKEND_URL}/api/check-nickname?nickname=${encodeURIComponent(newName)}`); const data = await res.json(); if(!data.available) { errorEl.textContent = data.message; return; } myProfile = JSON.parse(JSON.stringify(defaultProfile)); myProfile.name = newName; if (googlePicture) myProfile.profileImage = googlePicture; myUsername = newName; localStorage.setItem('fc_username', myUsername); saveData(); const overlay = document.getElementById('login-overlay'); if(overlay) overlay.remove(); finishSetup(); } catch(err) { errorEl.textContent = "서버 오류"; } }

async function initializeApp() { 
    try { 
        const token = localStorage.getItem('fc_id_token'); if(!token) { showLoginScreen(); return; }
        const homeView = document.getElementById('friend-list'); if(homeView && (!myProfile)) { homeView.innerHTML = `<div style="text-align:center; padding:60px 20px; color:#3182f6; font-weight:bold; font-size:16px;">💤 서버 데이터 불러오는 중...</div>`; }
        
        const serverResponse = await fetch(`${BACKEND_URL}/api/data?t=${new Date().getTime()}`, { headers: { "Authorization": `Bearer ${token}`, "Cache-Control": "no-cache" } }); 
        const serverData = await serverResponse.json(); 
        if (serverData.status === 'unauthenticated' || serverData.isNewUser) { showLoginScreen(); return; } 
        myProfile = serverData.profile; myEmail = localStorage.getItem('fc_email'); myUsername = myProfile.name; myNotifications = serverData.noti || []; myRooms = serverData.my_rooms || []; globalRanking = serverData.global_ranking || []; 
        const overlay = document.getElementById('login-overlay'); if(overlay) overlay.remove(); finishSetup(); 
    } catch(err) { console.error(err); alert("서버 연결에 실패했습니다."); } 
}

async function forceSync() {
    if (!localStorage.getItem('fc_id_token') || isSyncing) return;
    isSyncing = true;
    try {
        const res = await fetch(`${BACKEND_URL}/api/data?t=${new Date().getTime()}`, { headers: { "Authorization": `Bearer ${localStorage.getItem('fc_id_token')}`, "Cache-Control": "no-cache" } });
        const data = await res.json();
        if(data.status === 'unauthenticated' || data.isNewUser) { isSyncing = false; return; }
        
        myProfile = data.profile; myNotifications = data.noti || []; myRooms = data.my_rooms || []; globalRanking = data.global_ranking || [];
        
        const activeView = document.querySelector('.view-active');
        if(activeView) {
            const chatInput = document.getElementById('chat-input');
            const isChatFocused = chatInput && document.activeElement === chatInput;
            const currentChatText = chatInput ? chatInput.value : '';
            
            const chatBox = document.getElementById('chat-box');
            const isAtBottom = chatBox ? (chatBox.scrollHeight - chatBox.scrollTop <= chatBox.clientHeight + 30) : true;

            if(activeView.id === 'home-view') renderHome();
            if(activeView.id === 'meeting-view') renderMeeting();
            if(activeView.id === 'ranking-view') renderRanking();
            if(activeView.id === 'noti-view') renderNoti();
            if(activeView.id === 'profile-view') renderProfile();

            if (isChatFocused && document.getElementById('chat-input')) {
                const newChatInput = document.getElementById('chat-input');
                if(newChatInput) { newChatInput.focus(); newChatInput.value = currentChatText; }
            }
            const newChatBox = document.getElementById('chat-box');
            if (newChatBox && isAtBottom) { newChatBox.scrollTop = newChatBox.scrollHeight; }
        }
    } catch(e) {}
    isSyncing = false;
}

function startAutoSync() {
    if (autoSyncInterval) clearInterval(autoSyncInterval);
    autoSyncInterval = setInterval(forceSync, 5000); 
}

function finishSetup() { 
    if (myProfile && myProfile.isVIP === undefined) { myProfile.isVIP = false; myProfile.nameColor = '#333d4b'; } 
    if (myProfile && !myProfile.badges) myProfile.badges = []; 
    if (myProfile && !myProfile.stats) myProfile.stats = { goodGiven: 0, badGiven: 0, trialCount: 0 }; 
    if (myProfile && !myProfile.priceHistory) { myProfile.priceHistory = [myProfile.basePrice, myProfile.price]; myProfile.timeHistory = ["시작", getCurrentTime()]; } 
    else if (myProfile && !myProfile.timeHistory) { myProfile.timeHistory = myProfile.priceHistory.map(() => ""); }
    checkBadges(); updateTicker(); switchTab('home'); 
    
    startAutoSync();
}

window.onload = () => { if (!localStorage.getItem('fc_id_token')) { showLoginScreen(); } else { initializeApp(); } };

let myChartInstance = null; 
function drawPriceChart() {
    const ctx = document.getElementById('priceChart'); if (!ctx || !myProfile || !myProfile.priceHistory) return;
    if (myChartInstance) { myChartInstance.destroy(); }
    const history = myProfile.priceHistory; const labels = (myProfile.timeHistory && myProfile.timeHistory.length === history.length) ? myProfile.timeHistory : history.map(() => '');
    const isUp = history[history.length - 1] >= history[0]; const lineColor = isUp ? '#ff3b30' : '#3182f6'; const bgColor = isUp ? 'rgba(255, 59, 48, 0.1)' : 'rgba(49, 130, 246, 0.1)';
    myChartInstance = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [{ label: '내 주가 흐름', data: history, borderColor: lineColor, backgroundColor: bgColor, borderWidth: 3, pointRadius: 0, pointHoverRadius: 6, fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { bottom: 10 } }, animation: { duration: 1200, easing: 'easeOutQuart' }, plugins: { legend: { display: false } }, scales: { x: { display: true, grid: { display: false }, ticks: { font: { size: 9 }, color: '#8b95a1', maxTicksLimit: 5, maxRotation: 0, callback: function(val, index) { const label = this.getLabelForValue(val); if (label && label.includes(' ')) { return label.split(' ')[0]; } return label; } } }, y: { display: true, position: 'right', grid: { color: '#f2f4f6', drawBorder: false }, ticks: { font: { size: 10, family: 'sans-serif' }, color: '#8b95a1' } } }, interaction: { intersect: false, mode: 'index' } } });
}

let friendChartInstance = null; 
function drawFriendPriceChart(friend) {
    const ctx = document.getElementById('friendFriendChartCanvas'); if (!ctx) return;
    if (friendChartInstance) { friendChartInstance.destroy(); }
    let history = []; let labels = [];
    if (friend.priceHistory && friend.priceHistory.length > 0) { history = [...friend.priceHistory]; labels = (friend.timeHistory && friend.timeHistory.length === history.length) ? [...friend.timeHistory] : history.map(() => ''); if (history[history.length - 1] !== friend.price) { history.push(friend.price); labels.push(getCurrentTime()); } } 
    else { history = [friend.basePrice || 20000, friend.price]; labels = ["시작", getCurrentTime()]; }
    const isUp = history[history.length - 1] >= history[0]; const lineColor = isUp ? '#ff3b30' : '#3182f6'; const bgColor = isUp ? 'rgba(255, 59, 48, 0.1)' : 'rgba(49, 130, 246, 0.1)';
    friendChartInstance = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [{ label: '주가 흐름', data: history, borderColor: lineColor, backgroundColor: bgColor, borderWidth: 3, pointRadius: 0, pointHoverRadius: 6, fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { bottom: 10 } }, animation: { duration: 1200, easing: 'easeOutQuart' }, plugins: { legend: { display: false } }, scales: { x: { display: true, grid: { display: false }, ticks: { font: { size: 9 }, color: '#8b95a1', maxTicksLimit: 5, maxRotation: 0, callback: function(val, index) { const label = this.getLabelForValue(val); if (label && label.includes(' ')) { return label.split(' ')[0]; } return label; } } }, y: { display: true, position: 'right', grid: { color: '#f2f4f6', drawBorder: false }, ticks: { font: { size: 10 }, color: '#8b95a1' } } }, interaction: { intersect: false, mode: 'index' } } });
}