# 🪙 친구 코인 (Friend Coin)

**"내 친구의 가치는 얼마일까?"** 프라이빗 단톡방 기반 실시간 소셜 주식 평가 게임 🚀

친구 코인은 단톡방 안에서 서로의 가치(주가)를 호평과 악평을 통해 평가하고, 글로벌 랭킹을 겨루는 실시간 웹 서비스입니다. 

## 🎮 핵심 기능 (Features)
- **소셜 로그인 & 프로필:** Google OAuth 2.0 기반의 안전한 로그인 및 ImgBB API를 활용한 커스텀 프로필 이미지 업로드
- **프라이빗 단톡방 시스템:** 6자리 랜덤 코드를 통한 방 생성 및 입장
- **퍼센트(%) 기반 주가 변동 시스템:** - 제한된 티켓을 소모하여 타인에게 호평(👍) 또는 악평(👎) 행사
  - 타겟 유저의 현재 주가에 비례하여 1%, 2%, 3% 강도로 실시간 주가 반영
- **글로벌 랭킹 보드:** 모든 방의 유저 주가를 합산한 실시간 전국구 Top 10 랭킹 제공
- **보상 및 칭호 시스템:** 일일 출석, 광고 시청(시뮬레이션), 평가 통계에 따른 칭호 배지(👼천사, 😈악마 등) 부여

## 🛠️ 기술 스택 (Tech Stack)
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Python, FastAPI, Uvicorn
- **Database:** MongoDB Atlas
- **Hosting & Deployment:** Vercel (Client), Render (API Server)
- **External API:** Google Identity Services, ImgBB API

## 🚀 향후 업데이트 계획 (To-Do)
- [ ] **주주총회(재판) 시스템:** 상장폐지 위기나 악평 남발 시 방 멤버들끼리 투표로 심판하는 기능
- [ ] **실시간 차트 연동:** 개인별 주가 변동 내역을 시각적인 그래프로 제공
- [ ] **웹소켓(WebSocket) 도입:** 새로고침 없이 즉각적인 알림 및 실시간 주가 반영

Vercel: https://vercel.com/aiwab-s-projects/friend-coin
Render: https://dashboard.render.com/web/srv-d8fe15urnols73b3369g
Google Cloude Console: https://console.cloud.google.com/auth/overview?hl=ko&project=friend-coin-497914