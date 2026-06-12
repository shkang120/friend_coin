const BACKEND_URL = "https://friend-coin.onrender.com"; // ★ 본인의 진짜 주소 확인

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
    isVIP: false, nameColor: "#333d4b",
    priceHistory: [], timeHistory: []
};

let myProfile = null; let myNotifications = []; let myRooms = []; let globalRanking = [];   
let currentRoomCode = null; let currentAdRewardType = null; let adInterval = null; let currentSelectedFriend = null; 

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
    if (!myNotifications || myNotifications.length === 0) { container.innerHTML = '<div style="text-align:center; padding:40px; color:#8b95a1;">새로운 알림이 없습니다.</div>'; return; }
    container.innerHTML = myNotifications.map(n => `<div style="padding:15px; border-bottom:1px solid #f2f4f6; color:#333d4b;">${n}</div>`).join('');
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

// ★ 모든 데이터 전송 요청에 헤더 인증(Authorization: Bearer 토큰) 장착
function saveData() { 
    checkBadges(); updateTicker(); if (!myEmail) return;
    fetch(`${BACKEND_URL}/api/save`, { 
        method: "POST", 
        headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${localStorage.getItem('fc_id_token')}` // 신분증 동봉
        }, 
        body: JSON.stringify({ profile: myProfile, noti: myNotifications }) 
    }).catch(err => console.error(err));
}

function checkRefill() {
    if(!myProfile) return; const now = new Date(); const day = now.getDay(); let daysToSubtract = day - 1; if (daysToSubtract < 0) daysToSubtract = 6; if (day === 1 && now.getHours() < 8) daysToSubtract = 7; const recentMonday8AM = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToSubtract, 8, 0, 0, 0).getTime();
    if (myProfile.weeklyTicketsClaimed === undefined) { myProfile.goodTickets = 2; myProfile.badTickets = 2; myProfile.weeklyTicketsClaimed = false; myProfile.lastDailyAttendance = null; myProfile.lastRefillTime = Date.now(); saveData(); } 
    else if (!myProfile.lastRefillTime || myProfile.lastRefillTime < recentMonday8AM) { myProfile.goodTickets = 2; myProfile.badTickets = 2; myProfile.weeklyTicketsClaimed = false; myProfile.lastRefillTime = Date.now(); showToast("🔄 새로운 한 주! 평가권 리필 완료."); saveData(); }
}

function switchTab(tabName) {
    if(!myProfile) return; checkRefill(); checkBadges();
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('view-active'); });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const targetView = document.getElementById(tabName + '-view'); if (targetView) targetView.classList.add('view-active');
    const tabIndex = { 'home': 0, 'meeting': 1, 'ranking': 2, 'noti': 3, 'profile': 4 }[tabName];
    const navItems = document.querySelectorAll('.nav-item'); if (navItems[tabIndex]) navItems[tabIndex].classList.add('active');
    if (tabName === 'home') renderHome(); if (tabName === 'meeting') renderMeeting(); if (tabName === 'ranking') renderRanking(); if (tabName === 'noti') renderNoti(); if (tabName === 'profile') renderProfile();
}

function renderHome() {
    const list = document.getElementById('friend-list'); if(!list) return;
    if (!currentRoomCode) { 
        let html = `<div style="display:flex; gap:10px; margin-bottom:20px;"><button onclick="createNewRoom()" style="flex:1; padding:15px; background:#333d4b; color:white; border-radius:12px; font-weight:bold; border:none; cursor:pointer; box-shadow:0 4px 6px rgba(0,0,0,0.1);">+ 새 클럽 개설</button><button onclick="joinExistingRoom()" style="flex:1; padding:15px; background:#e8f5e9; color:#2e7d32; border-radius:12px; font-weight:bold; border:none; cursor:pointer; box-shadow:0 4px 6px rgba(0,0,0,0.05);">🔑 코드로 입장</button></div><h3 style="color:#333d4b; margin-top:0; font-size:16px;">내 투자 클럽 목록</h3>`;
        if (myRooms.length === 0) { html += `<div style="text-align:center; padding:50px 20px; color:#8b95a1; background:#f9fafb; border-radius:16px;">가입된 투자 클럽이 없습니다.</div>`; } 
        else { html += myRooms.map(r => `<div onclick="enterRoom('${r.room_code}')" class="info-card" style="cursor:pointer; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; border:2px solid transparent; transition:0.2s;" onmouseover="this.style.borderColor='#3182f6'" onmouseout="this.style.borderColor='transparent'"><div><div style="font-weight:bold; font-size:16px; color:#333d4b; margin-bottom:4px;">${r.room_name}</div><div style="font-size:12px; color:#8b95a1;">👥 ${r.members.length}명 | 🔑 코드: <span style="color:#3182f6; font-weight:bold;">${r.room_code}</span></div></div><div style="color:#3182f6; font-size:20px;">👉</div></div>`).join(''); }
        list.innerHTML = html;
    } else { 
        const room = myRooms.find(r => r.room_code === currentRoomCode); if (!room) { currentRoomCode = null; renderHome(); return; }
        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; background:#f2f4f6; padding:15px; border-radius:16px;"><button onclick="exitRoomView()" style="background:white; border:1px solid #e5e8eb; padding:8px 12px; border-radius:8px; font-size:14px; cursor:pointer; font-weight:bold; color:#4e5968;">🔙 로비로</button><div style="text-align:right;"><div style="font-weight:bold; color:#333d4b; font-size:16px;">${room.room_name}</div><div style="font-size:12px; color:#8b95a1;">초대 코드: <span style="color:#3182f6;">${room.room_code}</span></div></div></div><div style="background:#f9fafb; border-radius:16px; padding:15px; margin-bottom:20px; border:1px solid #eee;"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;"><div style="font-size:14px; font-weight:bold; color:#333d4b;">💬 클럽 라운지 (채팅)</div><button onclick="refreshChat()" style="background:none; border:none; color:#3182f6; font-size:12px; cursor:pointer; font-weight:bold;">🔄 새로고침</button></div><div id="chat-box" style="height:150px; overflow-y:auto; background:white; padding:10px; border-radius:10px; margin-bottom:10px; border:1px solid #e5e8eb; font-size:13px; display:flex; flex-direction:column; gap:8px;">${room.messages && room.messages.length > 0 ? room.messages.map(m => { const isMe = m.sender_email === myEmail; return `<div style="text-align:${isMe ? 'right' : 'left'};"><span style="font-size:11px; color:#8b95a1; margin-right:5px;">${isMe?'':m.sender_name}</span><div style="display:inline-block; padding:8px 12px; border-radius:12px; background:${isMe ? '#3182f6' : '#f2f4f6'}; color:${isMe ? 'white' : '#333d4b'}; max-width:80%; word-break:break-all;">${m.message}</div></div>`; }).join('') : '<div style="text-align:center; color:#8b95a1; margin-top:50px;">채팅이 없습니다. 첫 인사를 남겨보세요!</div>'}</div><div style="display:flex; gap:8px;"><input id="chat-input" type="text" placeholder="메시지 입력..." style="flex:1; padding:10px; border:1px solid #e5e8eb; border-radius:8px; outline:none;" onkeypress="if(event.key==='Enter') sendChat()"><button onclick="sendChat()" style="background:#333d4b; color:white; border:none; padding:10px 15px; border-radius:8px; font-weight:bold; cursor:pointer;">전송</button></div></div><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;"><h3 style="color:#333d4b; margin:0; font-size:15px;">참여자 목록 (${room.members.length}명)</h3><button onclick="openCreateAgendaModal()" style="background:#ff3b30; color:white; border:none; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:bold; cursor:pointer;">⚖️ 재판 열기</button></div>`;
        html += room.members.map(f => { const isMe = f.email === myEmail; const isDelisted = f.status === 'delisted'; const clickEvent = !isMe ? `onclick="openFriendDetail('${f.email}')"` : ""; const cardStyle = isDelisted ? "background: #f2f2f2; opacity: 0.6; cursor:pointer;" : (isMe ? "background: #f0f8ff; border: 1px solid #cce5ff;" : "cursor: pointer; transition: 0.2s; box-shadow:0 2px 4px rgba(0,0,0,0.05);"); return `<div class="info-card" style="display: flex; justify-content: space-between; align-items: center; ${cardStyle}" ${clickEvent}><div style="display: flex; align-items: center; gap: 15px;">${getAvatarHtml(f, 'small')}<div><div style="font-size: 16px; font-weight: bold;"><span style="color: ${f.nameColor || '#333d4b'};">${f.name}</span> ${isMe ? '<span style="font-size:11px; background:#3182f6; color:white; padding:2px 6px; border-radius:4px; margin-left:4px;">나</span>' : ''} ${isDelisted ? '<span style="color:#ff3b30; font-size:12px; font-weight:bold; margin-left:4px;">💀상장폐지</span>' : ''}</div>${getBadgeHtml(f)}</div></div><div style="font-size: 16px; font-weight: bold; color: #333d4b;">${isDelisted ? '-' : Math.floor(f.price || 0).toLocaleString()} p</div></div>`; }).join('');
        html += `<button onclick="leaveCurrentRoom()" style="width:100%; margin-top:20px; padding:12px; background:white; color:#ff3b30; border:1px solid #ffdbdb; border-radius:12px; font-weight:bold; cursor:pointer;">🚪 이 클럽에서 나가기</button>`;
        list.innerHTML = html; setTimeout(() => { const chatBox = document.getElementById('chat-box'); if(chatBox) chatBox.scrollTop = chatBox.scrollHeight; }, 10);
    }
}

function enterRoom(code) { currentRoomCode = code; renderHome(); }
function exitRoomView() { currentRoomCode = null; renderHome(); }

async function leaveCurrentRoom() { if(!confirm("정말 이 클럽에서 나가시겠습니까?")) return; try { const res = await fetch(`${BACKEND_URL}/api/room/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, room_code: currentRoomCode }) }); const data = await res.json(); if(data.status === 'success') { showToast("클럽에서 퇴장했습니다."); currentRoomCode = null; await initializeApp(); } } catch(err) { alert("오류 발생"); } }
async function sendChat() { const input = document.getElementById('chat-input'); const text = input.value.trim(); if(!text || !currentRoomCode) return; input.value = ''; try { await fetch(`${BACKEND_URL}/api/room/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ room_code: currentRoomCode, sender_email: myEmail, sender_name: myProfile.name, message: text }) }); await refreshChat(); } catch(err) { console.error(err); } }
async function refreshChat() { await initializeApp(); }

function openFriendDetail(friendEmail) {
    const room = myRooms.find(r => r.room_code === currentRoomCode); const friend = room.members.find(m => m.email === friendEmail); if (!friend) return;
    currentSelectedFriend = friend;
    if (friend.status === 'delisted') { if(confirm(`상장폐지된 코인입니다. 부활(회생) 재판을 발의하시겠습니까?`)) { openCreateAgendaModal('revival', friendEmail); } return; }

    let modal = document.getElementById('eval-modal');
    if(!modal) { modal = document.createElement('div'); modal.id = 'eval-modal'; modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; display:none; justify-content:center; align-items:center;"; document.body.appendChild(modal); }
    const p1 = Math.floor(friend.price * 0.01).toLocaleString(); const p2 = Math.floor(friend.price * 0.02).toLocaleString(); const p3 = Math.floor(friend.price * 0.03).toLocaleString();
    
    modal.innerHTML = `
        <div style="background:white; padding:30px 25px; border-radius:20px; width:85%; max-width:340px; text-align:center; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <div style="margin-bottom:15px;">${getAvatarHtml(friend, 'large')}</div>
            <h2 style="margin:0 0 5px 0; color:${friend.nameColor || '#333d4b'};">${friend.name}</h2>
            <div style="font-size:26px; font-weight:bold; color:#333d4b; margin-bottom:15px;">${Math.floor(friend.price).toLocaleString()} p</div>
            <div style="background: #ffffff; padding: 10px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #e5e8eb;"><canvas id="friendPriceChart" style="width:100%; height:100px;"></canvas></div>
            <div style="background:#f9fafb; padding:10px; border-radius:10px; font-size:12px; color:#8b95a1; margin-bottom:20px;">티켓은 무조건 1장 소모됩니다.<br>내 평가권: 👍 <b>${myProfile.goodTickets}장</b> | 👎 <b>${myProfile.badTickets}장</b></div>
            <textarea id="eval-reason-input" placeholder="이 코인을 평가하는 사유를 적어주세요 (필수)" style="width:100%; height:60px; padding:10px; border:1px solid #e5e8eb; border-radius:8px; margin-bottom:15px; box-sizing:border-box; resize:none; font-family:sans-serif; outline:none; font-size:13px;"></textarea>
            <div style="text-align:left; margin-bottom:15px;"><div style="font-size:13px; font-weight:bold; color:#ff3b30; margin-bottom:8px;">👍 호평하기 (티켓 1장)</div><div style="display:flex; gap:8px;"><button onclick="submitEvaluation('good', 1)" style="flex:1; padding:10px 5px; background:#fff2f2; border:1px solid #ffdbdb; border-radius:8px; color:#ff3b30; font-weight:bold; cursor:pointer; font-size:12px;">+1%<br><span style="font-size:10px;">+${p1}p</span></button><button onclick="submitEvaluation('good', 2)" style="flex:1; padding:10px 5px; background:#fff2f2; border:1px solid #ffdbdb; border-radius:8px; color:#ff3b30; font-weight:bold; cursor:pointer; font-size:12px;">+2%<br><span style="font-size:10px;">+${p2}p</span></button><button onclick="submitEvaluation('good', 3)" style="flex:1; padding:10px 5px; background:#ff3b30; border:1px solid #ff3b30; border-radius:8px; color:white; font-weight:bold; cursor:pointer; font-size:12px;">+3%<br><span style="font-size:10px;">+${p3}p</span></button></div></div>
            <div style="text-align:left; margin-bottom:25px;"><div style="font-size:13px; font-weight:bold; color:#3182f6; margin-bottom:8px;">👎 악평하기 (티켓 1장)</div><div style="display:flex; gap:8px;"><button onclick="submitEvaluation('bad', 1)" style="flex:1; padding:10px 5px; background:#f0f8ff; border:1px solid #d6ebff; border-radius:8px; color:#3182f6; font-weight:bold; cursor:pointer; font-size:12px;">-1%<br><span style="font-size:10px;">-${p1}p</span></button><button onclick="submitEvaluation('bad', 2)" style="flex:1; padding:10px 5px; background:#f0f8ff; border:1px solid #d6ebff; border-radius:8px; color:#3182f6; font-weight:bold; cursor:pointer; font-size:12px;">-2%<br><span style="font-size:10px;">-${p2}p</span></button><button onclick="submitEvaluation('bad', 3)" style="flex:1; padding:10px 5px; background:#3182f6; border:1px solid #3182f6; border-radius:8px; color:white; font-weight:bold; cursor:pointer; font-size:12px;">-3%<br><span style="font-size:10px;">-${p3}p</span></button></div></div>
            <button onclick="document.getElementById('eval-modal').style.display='none'" style="width:100%; padding:12px; background:#f2f4f6; color:#8b95a1; border:none; border-radius:12px; font-weight:bold; cursor:pointer; font-size:14px;">취소</button>
        </div>
    `;
    modal.style.display = 'flex'; setTimeout(() => drawFriendPriceChart(friend), 50);
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
        const data = await res.json(); 
        if (data.status === 'success') { showToast(`✅ 주가 조정 완료!`); await initializeApp(); } else { alert(data.message); }
    } catch(err) { alert("네트워크 오류 발생"); }
}

function openCreateAgendaModal(defaultType = 'delist', targetEmail = '') {
    const room = myRooms.find(r => r.room_code === currentRoomCode); if (!room) return;
    let modal = document.getElementById('agenda-create-modal');
    if(!modal) { modal = document.createElement('div'); modal.id = 'agenda-create-modal'; modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; display:none; justify-content:center; align-items:center;"; document.body.appendChild(modal); }
    const memberOptions = room.members.filter(m => m.email !== myEmail).map(m => `<option value="${m.email}" ${m.email === targetEmail ? 'selected' : ''}>${m.name} (${m.status === 'delisted' ? '상폐상태' : Math.floor(m.price)+'p'})</option>`).join('');
    modal.innerHTML = `
        <div style="background:white; padding:25px; border-radius:20px; width:85%; max-width:340px; text-align:left; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <h3 style="margin-top:0; color:#333d4b; text-align:center; font-size:18px;">⚖️ 주주총회 재판 기소장</h3>
            <label style="font-size:12px; font-weight:bold; color:#4e5968; display:block; margin-bottom:6px;">1. 재판 대상자</label><select id="agenda-target-select" style="width:100%; padding:12px; border:1px solid #e5e8eb; border-radius:10px; margin-bottom:15px; background:white; outline:none;">${memberOptions}</select>
            <label style="font-size:12px; font-weight:bold; color:#4e5968; display:block; margin-bottom:6px;">2. 목적</label><select id="agenda-type-select" style="width:100%; padding:12px; border:1px solid #e5e8eb; border-radius:10px; margin-bottom:15px; background:white; outline:none;"><option value="delist" ${defaultType === 'delist' ? 'selected' : ''}>🚨 자동/수동 상장폐지 심사 건</option><option value="revival" ${defaultType === 'revival' ? 'selected' : ''}>🌱 갱생 및 코인 회생 재상장 건</option></select>
            <label style="font-size:12px; font-weight:bold; color:#4e5968; display:block; margin-bottom:6px;">3. 기소 사유</label><textarea id="agenda-reason-input" placeholder="사유를 명시해 주세요." style="width:100%; height:80px; padding:12px; border:1px solid #e5e8eb; border-radius:10px; margin-bottom:20px; box-sizing:border-box; resize:none; font-family:sans-serif; outline:none;"></textarea>
            <div style="display:flex; gap:10px;"><button onclick="document.getElementById('agenda-create-modal').style.display='none'" style="flex:1; padding:12px; background:#f2f4f6; border:none; border-radius:10px; font-weight:bold; color:#8b95a1; cursor:pointer;">취소</button><button onclick="submitCreateAgenda()" style="flex:1; padding:12px; background:#333d4b; border:none; border-radius:10px; font-weight:bold; color:white; cursor:pointer;">재판 시작 ⚖️</button></div>
        </div>
    `;
    modal.style.display = 'flex';
}
async function submitCreateAgenda() {
    const targetSelect = document.getElementById('agenda-target-select'); if(!targetSelect) { alert("대상이 없습니다!"); return; }
    const targetEmail = targetSelect.value; const agendaType = document.getElementById('agenda-type-select').value; const reason = document.getElementById('agenda-reason-input').value.trim();
    if(!reason) { alert("사유를 입력하세요!"); return; }
    document.getElementById('agenda-create-modal').style.display = 'none'; showToast("⏳ 안건 상정 중...");
    try { const res = await fetch(`${BACKEND_URL}/api/agenda/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ room_code: currentRoomCode, creator_email: myEmail, target_email: targetEmail, agenda_type: agendaType, reason: reason }) }); const data = await res.json(); if(data.status === 'success') { alert(data.message); myProfile.stats.trialCount = (myProfile.stats.trialCount || 0) + 1; saveData(); await initializeApp(); switchTab('meeting'); } else { alert(data.message); } } catch(err) { alert("서버 통신 실패"); }
}

function renderMeeting() {
    const list = document.getElementById('meeting-list'); if(!list) return;
    if (!currentRoomCode) { list.innerHTML = '<div style="text-align:center; padding:50px 20px; color:#8b95a1; background:#f9fafb; border-radius:16px;">로비에서는 재판이 열리지 않습니다.</div>'; return; }
    const room = myRooms.find(r => r.room_code === currentRoomCode); const activeAgendas = room.agendas ? room.agendas.filter(a => a.status === 'active') : [];
    if (activeAgendas.length === 0) { list.innerHTML = `<div style="text-align:center; padding:50px 20px; color:#8b95a1; background:#f9fafb; border-radius:16px;">🕊️ [${room.room_name}] 방은 현재 평온합니다.<br>진행 중인 재판이 없습니다.</div>`; return; }
    const totalMembers = room.members.length; const requiredVotes = Math.floor(totalMembers / 2) + 1;
    list.innerHTML = activeAgendas.map(a => {
        let titleColor = '#ff3b30'; let titleText = '🚨 상장폐지 심사 법정'; if (a.type === 'revival') { titleColor = '#2e7d32'; titleText = '🌱 코인 회생 재상장 건'; }
        const targetPerson = room.members.find(f => f.email === a.target_email); const avatarHtml = targetPerson ? getAvatarHtml(targetPerson, 'small') : ''; const hasVoted = a.votedUsers && a.votedUsers.includes(myEmail);
        let btnHtml = hasVoted ? `<button style="width:100%; background:#e5e8eb; color:#8b95a1; border:none; padding:12px; border-radius:10px; font-weight:bold; cursor:not-allowed;" disabled>⚖️ 투표 완료</button>` : `<button class="btn-vote-disagree" style="flex:1; background:#f2f4f6; color:#4e5968;" onclick="submitVote('${a.id}', 'disagree')">반대(기각)</button><button class="btn-vote-agree" style="flex:1; background:${titleColor};" onclick="submitVote('${a.id}', 'agree')">찬성(판결)</button>`;
        return `<div class="info-card" style="border-left: 5px solid ${titleColor};"><div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">${avatarHtml}<div><div style="color: ${titleColor}; font-weight: bold; font-size:15px;">[${titleText}]</div><div style="font-size:13px; color:#333d4b;">피고인: <b>${a.target_name}</b></div></div></div><div style="background:#f9fafb; padding:12px; border-radius:10px; font-size:14px; color:#4e5968; line-height:1.5; margin-bottom:12px; border:1px dashed #e5e8eb;"><b>📝 기소 사유:</b><br>${a.reason}</div><div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#8b95a1; margin-bottom:12px; background:#fff; padding:4px;"><div>👍 찬성: <b style="color:#ff3b30;">${a.agreeVotes}표</b></div><div>👎 반대: <b style="color:#3182f6;">${a.disagreeVotes}표</b></div><div style="background:#e8f5e9; color:#2e7d32; padding:2px 6px; border-radius:4px; font-weight:bold;">정족수: (${requiredVotes}/${totalMembers}명)</div></div><div style="display: flex; gap: 10px;">${btnHtml}</div></div>`;
    }).join('');
}
async function submitVote(agendaId, voteType) { showToast("⏳ 표결 전달 중..."); try { const res = await fetch(`${BACKEND_URL}/api/agenda/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ room_code: currentRoomCode, agenda_id: agendaId, voter_email: myEmail, vote_type: voteType }) }); const data = await res.json(); if (data.status === 'resolved') { alert(`⚖️ [최종 판결]\n${data.message}`); await initializeApp(); switchTab('home'); } else if (data.status === 'success') { showToast("📥 투표 완료"); await initializeApp(); switchTab('meeting'); } else { alert(data.message); } } catch(err) { alert("네트워크 오류"); } }

async function createNewRoom() { const name = prompt("새 투자 클럽 이름을 입력하세요:"); if(!name || name.trim() === "") return; try { const res = await fetch(`${BACKEND_URL}/api/room/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, room_name: name.trim() }) }); const data = await res.json(); if(data.status === 'success') { alert(`🎉 클럽 생성 완료!\n초대 코드: [ ${data.room_code} ]`); await initializeApp(); } } catch(err) { alert("서버 오류"); } }
async function joinExistingRoom() { const code = prompt("초대 코드를 입력하세요:"); if(!code || code.trim() === "") return; try { const res = await fetch(`${BACKEND_URL}/api/room/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, room_code: code.trim().toUpperCase() }) }); const data = await res.json(); if(data.status === 'error') { alert(data.message); return; } alert(`🚪 입장 성공!`); await initializeApp(); } catch(err) { alert("서버 오류"); } }

function renderRanking() {
    const container = document.getElementById('ranking-content'); if (!container || !myProfile || globalRanking.length === 0) return;
    const top10 = globalRanking.slice(0, 10);
    const createTotalRankCard = (p, index) => {
        const medals = ['🥇', '🥈', '🥉']; const rankIcon = index < 3 ? medals[index] : `<span style="display:inline-block; width: 24px; text-align:center; color:#8b95a1; font-size:14px; font-weight:bold;">${index+1}</span>`;
        const isMe = p.name === myProfile.name; const bg = isMe ? "background:#f0f8ff;" : "";
        return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 10px; border-bottom: 1px solid #f9fafb; border-radius:8px; ${bg}"><div style="display: flex; align-items: center; font-size: 15px; font-weight: bold;"><span style="font-size: 18px; margin-right: 10px; width:20px; text-align:center;">${rankIcon}</span>${getAvatarHtml(p, 'small')}<span style="margin-left:10px; color: ${p.nameColor || '#333d4b'};">${p.name}</span> ${isMe ? '<span style="font-size:11px; background:#3182f6; color:white; padding:2px 6px; border-radius:4px; margin-left:4px;">나</span>' : ''}</div><div style="font-weight: bold; color: #333d4b;">${Math.floor(p.price||0).toLocaleString()} p</div></div>`;
    };
    container.innerHTML = `<div style="background: white; border-radius: 16px; padding: 20px 15px; margin-bottom: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #eee;"><h3 style="margin-top: 0; color: #333d4b;">🌍 전국구 통합 랭킹 Top 10</h3><p style="font-size:12px; color:#8b95a1; margin-bottom:20px;">모든 클럽의 주가가 합산된 실시간 순위보드입니다.</p>${top10.map((p, i) => createTotalRankCard(p, i)).join('')}</div>`;
}

async function doDailyAttendance() { 
    const today = new Date().toDateString(); if (myProfile.lastDailyAttendance === today) { showToast("이미 완료하셨습니다!"); return; } showToast("⏳ 출석 처리 중...");
    try {
        const res = await fetch(`${BACKEND_URL}/api/reward`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, reward_type: 'attendance', today_str: today }) });
        const data = await res.json(); if(data.status === 'success') { myProfile = data.profile; showToast(data.message); saveData(); renderProfile(); } else { showToast(data.message); }
    } catch(err) { alert("서버 오류"); }
}

function watchAd(type) {
    const todayStr = new Date().toDateString(); if (type === 'double_attendance') { if (myProfile.lastDailyAttendance !== todayStr) { showToast("출석체크를 먼저 해주세요."); return; } if (myProfile.lastDailyAdBonus === todayStr) { showToast("이미 2배 보상을 받았습니다."); return; } } else if (type === 'extra_ticket') { if (myProfile.dailyAdTicketsDate !== todayStr) { myProfile.dailyAdTicketsCount = 0; myProfile.dailyAdTicketsDate = todayStr; } if (myProfile.dailyAdTicketsCount >= 1) { showToast("오늘은 더 받을 수 없습니다."); return; } }
    currentAdRewardType = type; if (myProfile.isVIP) { claimAdReward(true); return; }
    document.getElementById('ad-modal').style.display = 'flex'; let timeLeft = 3; document.getElementById('ad-timer').textContent = `광고 준비 중... (${timeLeft}초)`;
    const btn = document.getElementById('ad-close-btn'); btn.textContent = "광고를 끝까지 시청해주세요"; btn.style.background = "#e5e8eb"; btn.style.color = "#8b95a1"; btn.disabled = true; btn.onclick = null;
    adInterval = setInterval(() => { timeLeft--; if (timeLeft > 0) { document.getElementById('ad-timer').textContent = `광고 시청 중... (${timeLeft}초)`; } else { clearInterval(adInterval); document.getElementById('ad-timer').textContent = "✅ 시청 완료!"; btn.textContent = "보상 받기 🎁"; btn.style.background = "#3182f6"; btn.style.color = "white"; btn.disabled = false; btn.onclick = () => claimAdReward(false); } }, 1000);
}

async function claimAdReward(isVipPass = false) { 
    document.getElementById('ad-modal').style.display = 'none'; const todayStr = new Date().toDateString(); showToast("⏳ 보상 수령 중...");
    try {
        const res = await fetch(`${BACKEND_URL}/api/reward`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, reward_type: currentAdRewardType, today_str: todayStr }) });
        const data = await res.json(); if(data.status === 'success') { myProfile = data.profile; showToast(isVipPass ? `👑 VIP 프리패스! ${data.message}` : data.message); saveData(); renderProfile(); } else { showToast(data.message); }
    } catch(err) { alert("서버 오류"); }
}

async function claimWeeklyTickets() { 
    if (myProfile.weeklyTicketsClaimed) { showToast("이미 획득하셨습니다!"); return; } showToast("⏳ 처리 중...");
    try {
        const res = await fetch(`${BACKEND_URL}/api/reward`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('fc_id_token')}` }, body: JSON.stringify({ email: myEmail, reward_type: 'weekly', today_str: new Date().toDateString() }) });
        const data = await res.json(); if(data.status === 'success') { myProfile = data.profile; showToast(data.message); saveData(); renderProfile(); } else { showToast(data.message); }
    } catch(err) { alert("서버 오류"); }
}

function openVIPModal() { document.getElementById('vip-modal').style.display = 'flex'; if (myProfile.isVIP) { document.getElementById('vip-buy-section').style.display = 'none'; document.getElementById('vip-manage-section').style.display = 'block'; document.getElementById('vip-color-picker').value = myProfile.nameColor || '#333d4b'; } else { document.getElementById('vip-buy-section').style.display = 'block'; document.getElementById('vip-manage-section').style.none; } }
function closeVIPModal() { document.getElementById('vip-modal').style.display = 'none'; }
function buyVIP() { myProfile.isVIP = true; myProfile.nameColor = '#d4af37'; saveData(); showToast("💎 VIP 멤버십 가입 완료!"); openVIPModal(); renderProfile(); }
function applyVIPColor() { const color = document.getElementById('vip-color-picker').value; myProfile.nameColor = color; saveData(); showToast("🎨 색상 변경!"); closeVIPModal(); renderProfile(); }

function renderProfile() {
    const container = document.getElementById('my-profile-info'); if(!container || !myProfile) return;
    const isDelisted = myProfile.status === 'delisted'; const changeAmount = myProfile.price - myProfile.basePrice; const changeRate = ((changeAmount / myProfile.basePrice) * 100).toFixed(1);
    const colorClass = changeAmount > 0 ? '#ff3b30' : (changeAmount < 0 ? '#3182f6' : '#8b95a1'); const sign = changeAmount > 0 ? '+' : '';
    const vipBanner = myProfile.isVIP ? `<div style="background: linear-gradient(135deg, #d4af37, #f3e5f5); padding: 15px; border-radius: 12px; color: white; font-weight: bold; cursor: pointer; margin-bottom: 20px; text-align: left; display: flex; justify-content: space-between; align-items: center;" onclick="openVIPModal()"><div style="color:#333d4b;">👑 VIP 멤버십 적용 중</div><div style="font-size: 12px; background: rgba(255,255,255,0.4); color: #333d4b; padding: 6px 10px; border-radius: 6px;">설정 ⚙️</div></div>` : `<div style="background: #333d4b; padding: 15px; border-radius: 12px; color: #d4af37; font-weight: bold; cursor: pointer; margin-bottom: 20px; text-align: left; display: flex; justify-content: space-between; align-items: center;" onclick="openVIPModal()"><div>💎 프리미엄 가입하기</div><div style="font-size: 12px; background: rgba(255,255,255,0.1); padding: 6px 10px; border-radius: 6px; color:white;">알아보기 👉</div></div>`;
    const todayStr = new Date().toDateString(); const hasDailyDone = myProfile.lastDailyAttendance === todayStr;
    const dailyBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: ${hasDailyDone ? '#e5e8eb' : '#e8f5e9'}; color: ${hasDailyDone ? '#8b95a1' : '#2e7d32'}; font-weight: bold; border: none; cursor: ${hasDailyDone ? 'not-allowed' : 'pointer'}; margin-bottom: 10px;" onclick="doDailyAttendance()" ${hasDailyDone ? 'disabled' : ''}>📅 매일 출석 (+50p)</button>`;
    const hasAdBonusDone = myProfile.lastDailyAdBonus === todayStr; let adDoubleBtn = ''; if (hasDailyDone && !hasAdBonusDone) { adDoubleBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: #e3f2fd; color: #1565c0; font-weight: bold; border: none; cursor: pointer; margin-bottom: 10px;" onclick="watchAd('double_attendance')">🎬 광고 보고 2배 출석 (+50p)</button>`; } else if (hasDailyDone && hasAdBonusDone) { adDoubleBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: #e5e8eb; color: #8b95a1; font-weight: bold; border: none; cursor: not-allowed; margin-bottom: 10px;" disabled>✅ 출석 보상 2배 완료</button>`; }
    const hasWeeklyDone = myProfile.weeklyTicketsClaimed === true; const weeklyBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: ${hasWeeklyDone ? '#e5e8eb' : '#fff3e0'}; color: ${hasWeeklyDone ? '#8b95a1' : '#e65100'}; font-weight: bold; border: none; cursor: ${hasWeeklyDone ? 'not-allowed' : 'pointer'}; margin-bottom: 10px;" onclick="claimWeeklyTickets()" ${hasWeeklyDone ? 'disabled' : ''}>🎁 주간 보너스 평가권 (각 +1장)</button>`;
    if (myProfile.dailyAdTicketsDate !== todayStr) myProfile.dailyAdTicketsCount = 0; const adTicketCount = myProfile.dailyAdTicketsCount || 0; const isAdTicketMax = adTicketCount >= 1;
    const adTicketBtn = `<button style="width: 100%; padding: 12px; border-radius: 12px; background: ${isAdTicketMax ? '#e5e8eb' : '#f3e5f5'}; color: ${isAdTicketMax ? '#8b95a1' : '#6a1b9a'}; font-weight: bold; border: none; cursor: ${isAdTicketMax ? 'not-allowed' : 'pointer'}; margin-bottom: 10px;" onclick="watchAd('extra_ticket')" ${isAdTicketMax ? 'disabled' : ''}>🎬 광고 보고 평가권 추가 (${adTicketCount}/1회)</button>`;

    let actionBtn = `${dailyBtn}${adDoubleBtn}${weeklyBtn}${adTicketBtn}`;
    if (isDelisted) { actionBtn = `<div style="background:#ffebee; color:#c62828; padding:15px; border-radius:12px; font-weight:bold; text-align:center; font-size:14px; margin-bottom:15px;">💀 코인이 상장폐지 상태입니다.<br>라운지 채팅창에서 친구들에게 회생 구제 요청 재판 발의를 부탁해 보세요!</div>`; }

    container.innerHTML = `
        ${vipBanner}
        <div style="position: relative; display: inline-block;">${getAvatarHtml(myProfile, 'large')}<button onclick="openProfileModal()" style="position: absolute; bottom: 0; right: -10px; background: #3182f6; color: white; border: none; border-radius: 50%; width: 32px; height: 32px; font-size: 14px; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">✏️</button></div>
        <h2 style="margin: 10px 0; color: ${myProfile.nameColor || '#333d4b'}; display:flex; justify-content:center; align-items:center; gap:8px;">${myProfile.name} 코인 <span onclick="changeNickname()" style="font-size:14px; color:#8b95a1; background:#f2f4f6; padding:4px 8px; border-radius:6px; cursor:pointer;">변경</span></h2>
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
function selectDefaultProfile(url) { myProfile.profileImage = url; saveData(); showToast("프로厌 이미지 변경!"); closeProfileModal(); renderProfile(); }
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

// ★ 로그인 시 구글 ID 토큰(발급된 정식 신분증)을 localStorage에 영구 보관
async function handleCredentialResponse(response) {
    const responsePayload = decodeJwtResponse(response.credential); const tempEmail = responsePayload.email; 
    const idToken = response.credential;
    localStorage.setItem('fc_id_token', idToken); // 신분증 보관
    localStorage.setItem('fc_email', tempEmail);
    
    const overlay = document.getElementById('login-overlay'); if(overlay) overlay.innerHTML = `<div style="font-size:20px; font-weight:bold; color:#333d4b;">서버 연결 중... ⏳</div>`; 
    try {
        const serverResponse = await fetch(`${BACKEND_URL}/api/data`, { headers: { "Authorization": `Bearer ${idToken}` } }); 
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
        const serverResponse = await fetch(`${BACKEND_URL}/api/data`, { headers: { "Authorization": `Bearer ${token}` } }); 
        const serverData = await serverResponse.json(); 
        if (serverData.status === 'unauthenticated' || serverData.isNewUser) { showLoginScreen(); return; } 
        myProfile = serverData.profile; myEmail = localStorage.getItem('fc_email'); myUsername = myProfile.name; myNotifications = serverData.noti || []; myRooms = serverData.my_rooms || []; globalRanking = serverData.global_ranking || []; 
        const overlay = document.getElementById('login-overlay'); if(overlay) overlay.remove(); finishSetup(); 
    } catch(err) { console.error(err); alert("서버 연결에 실패했습니다."); } 
}

function finishSetup() { 
    if (myProfile && myProfile.isVIP === undefined) { myProfile.isVIP = false; myProfile.nameColor = '#333d4b'; } 
    if (myProfile && !myProfile.badges) myProfile.badges = []; 
    if (myProfile && !myProfile.stats) myProfile.stats = { goodGiven: 0, badGiven: 0, trialCount: 0 }; 
    if (myProfile && !myProfile.priceHistory) { myProfile.priceHistory = [myProfile.basePrice, myProfile.price]; myProfile.timeHistory = ["시작", getCurrentTime()]; } 
    else if (myProfile && !myProfile.timeHistory) { myProfile.timeHistory = myProfile.priceHistory.map(() => ""); }
    checkRefill(); checkBadges(); updateTicker(); switchTab('home'); 
}

window.onload = () => { if (!localStorage.getItem('fc_id_token')) { showLoginScreen(); } else { initializeApp(); } };

let myChartInstance = null; 
function drawPriceChart() {
    const ctx = document.getElementById('priceChart'); if (!ctx || !myProfile || !myProfile.priceHistory) return;
    if (myChartInstance) { myChartInstance.destroy(); }
    const history = myProfile.priceHistory; const labels = (myProfile.timeHistory && myProfile.timeHistory.length === history.length) ? myProfile.timeHistory : history.map(() => '');
    const isUp = history[history.length - 1] >= history[0]; const lineColor = isUp ? '#ff3b30' : '#3182f6'; const bgColor = isUp ? 'rgba(255, 59, 48, 0.1)' : 'rgba(49, 130, 246, 0.1)';
    myChartInstance = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [{ label: '내 주가 흐름', data: history, borderColor: lineColor, backgroundColor: bgColor, borderWidth: 3, pointRadius: 0, pointHoverRadius: 6, fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1200, easing: 'easeOutQuart' }, plugins: { legend: { display: false } }, scales: { x: { display: true, grid: { display: false }, ticks: { font: { size: 9 }, color: '#8b95a1', maxTicksLimit: 5, maxRotation: 0 } }, y: { display: true, position: 'right', grid: { color: '#f2f4f6', drawBorder: false }, ticks: { font: { size: 10, family: 'sans-serif' }, color: '#8b95a1' } } }, interaction: { intersect: false, mode: 'index' } } });
}

let friendChartInstance = null; 
function drawFriendPriceChart(friend) {
    const ctx = document.getElementById('friendPriceChart'); if (!ctx) return;
    if (friendChartInstance) { friendChartInstance.destroy(); }
    let history = []; let labels = [];
    if (friend.priceHistory && friend.priceHistory.length > 0) { history = [...friend.priceHistory]; labels = (friend.timeHistory && friend.timeHistory.length === history.length) ? [...friend.timeHistory] : history.map(() => ''); if (history[history.length - 1] !== friend.price) { history.push(friend.price); labels.push(getCurrentTime()); } } 
    else { history = [friend.basePrice || 20000, friend.price]; labels = ["시작", getCurrentTime()]; }
    const isUp = history[history.length - 1] >= history[0]; const lineColor = isUp ? '#ff3b30' : '#3182f6'; const bgColor = isUp ? 'rgba(255, 59, 48, 0.1)' : 'rgba(49, 130, 246, 0.1)';
    friendChartInstance = new Chart(ctx, { type: 'line', data: { labels: labels, datasets: [{ label: '주가 흐름', data: history, borderColor: lineColor, backgroundColor: bgColor, borderWidth: 3, pointRadius: 0, pointHoverRadius: 6, fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1200, easing: 'easeOutQuart' }, plugins: { legend: { display: false } }, scales: { x: { display: true, grid: { display: false }, ticks: { font: { size: 9 }, color: '#8b95a1', maxTicksLimit: 5, maxRotation: 0 } }, y: { display: true, position: 'right', grid: { color: '#f2f4f6', drawBorder: false }, ticks: { font: { size: 10 }, color: '#8b95a1' } } }, interaction: { intersect: false, mode: 'index' } } });
}