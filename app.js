// ============================================================
// CivicGuide — app.js  (Gamification-Enhanced)
// ============================================================

// --- State ---
let currentLanguage = 'en';

// --- Configuration ---
// API key is stored server-side. The browser calls /api/gemini (our proxy).

// System prompt is defined server-side in server.js

// ============================================================
//  GAMIFICATION SYSTEM
// ============================================================

const GAMIFICATION_KEY = 'civicguide_gamification_v2';

const BADGE_DEFINITIONS = [
    { id: 'first_quiz', icon: '🗳️', name: 'First Vote', desc: 'Complete your first quiz', condition: (s) => s.quizzesCompleted >= 1 },
    { id: 'perfect_5', icon: '🏆', name: 'Flawless Voter', desc: 'Score 5/5 on any quiz', condition: (s) => s.perfectScores >= 1 },
    { id: 'streak_3', icon: '🔥', name: 'On a Roll', desc: 'Maintain a 3-day streak', condition: (s) => s.maxStreak >= 3 },
    { id: 'streak_7', icon: '⚡', name: 'Civic Warrior', desc: 'Maintain a 7-day streak', condition: (s) => s.maxStreak >= 7 },
    { id: 'quizzes_5', icon: '📚', name: 'Dedicated Learner', desc: 'Complete 5 quizzes', condition: (s) => s.quizzesCompleted >= 5 },
    { id: 'quizzes_10', icon: '🎓', name: 'Civic Scholar', desc: 'Complete 10 quizzes', condition: (s) => s.quizzesCompleted >= 10 },
    { id: 'xp_500', icon: '💎', name: 'Diamond Citizen', desc: 'Earn 500 XP', condition: (s) => s.totalXP >= 500 },
    { id: 'xp_1000', icon: '👑', name: 'Civic Champion', desc: 'Earn 1000 XP', condition: (s) => s.totalXP >= 1000 },
    { id: 'explorer', icon: '🔭', name: 'Explorer', desc: 'Search 3 constituencies', condition: (s) => s.constituencySearches >= 3 },
    { id: 'speed_demon', icon: '⏱️', name: 'Speed Demon', desc: 'Answer 3 questions without using hints', condition: (s) => s.fastAnswers >= 3 },
];

const LEVELS = [
    { level: 1, name: 'Citizen', xpRequired: 0 },
    { level: 2, name: 'Informed Voter', xpRequired: 100 },
    { level: 3, name: 'Civic Advocate', xpRequired: 250 },
    { level: 4, name: 'Democracy Defender', xpRequired: 500 },
    { level: 5, name: 'Election Expert', xpRequired: 1000 },
    { level: 6, name: 'Civic Legend', xpRequired: 2000 },
];

const XP_REWARDS = {
    CORRECT_ANSWER: 20,
    PERFECT_QUIZ: 50,   // bonus
    STREAK_BONUS: 5,   // per day of active streak
    CONSTITUENCY_SEARCH: 10,
    QUIZ_COMPLETE: 15,
};

function getDefaultGameState() {
    return {
        totalXP: 0,
        currentStreak: 0,
        maxStreak: 0,
        lastActiveDate: null,   // ISO date string YYYY-MM-DD
        quizzesCompleted: 0,
        perfectScores: 0,
        constituencySearches: 0,
        fastAnswers: 0,
        badges: [],             // array of badge ids earned
        weeklyHistory: [],      // last 7 entries: [{date, xpEarned}]
        leaderboard: [],        // [{name, xp, level}] — persisted locally
    };
}

function loadGameState() {
    try {
        const raw = localStorage.getItem(GAMIFICATION_KEY);
        if (raw) return { ...getDefaultGameState(), ...JSON.parse(raw) };
    } catch (_) { }
    return getDefaultGameState();
}

function saveGameState(state) {
    localStorage.setItem(GAMIFICATION_KEY, JSON.stringify(state));
}

let gameState = loadGameState();

// Ensure streak is updated on load
function refreshStreak() {
    const today = new Date().toISOString().slice(0, 10);
    if (!gameState.lastActiveDate) return;
    const last = new Date(gameState.lastActiveDate);
    const now = new Date(today);
    const diffDays = Math.round((now - last) / 86400000);
    if (diffDays > 1) {
        gameState.currentStreak = 0;
        saveGameState(gameState);
    }
}
refreshStreak();

function markActiveToday() {
    const today = new Date().toISOString().slice(0, 10);
    if (gameState.lastActiveDate === today) return;
    const last = gameState.lastActiveDate;
    if (last) {
        const diffDays = Math.round((new Date(today) - new Date(last)) / 86400000);
        if (diffDays === 1) {
            gameState.currentStreak++;
        } else {
            gameState.currentStreak = 1;
        }
    } else {
        gameState.currentStreak = 1;
    }
    if (gameState.currentStreak > gameState.maxStreak) {
        gameState.maxStreak = gameState.currentStreak;
    }
    gameState.lastActiveDate = today;

    // Weekly history
    const todayEntry = gameState.weeklyHistory.find(e => e.date === today);
    if (!todayEntry) {
        gameState.weeklyHistory.push({ date: today, xpEarned: 0 });
        if (gameState.weeklyHistory.length > 7) gameState.weeklyHistory.shift();
    }
    saveGameState(gameState);
}

function getCurrentLevel() {
    let currentLevel = LEVELS[0];
    for (const lvl of LEVELS) {
        if (gameState.totalXP >= lvl.xpRequired) currentLevel = lvl;
    }
    return currentLevel;
}

function getNextLevel() {
    const cur = getCurrentLevel();
    return LEVELS.find(l => l.level === cur.level + 1) || null;
}

function awardXP(amount, reason = '') {
    gameState.totalXP += amount;
    markActiveToday();

    // Add to today's weekly history
    const today = new Date().toISOString().slice(0, 10);
    const entry = gameState.weeklyHistory.find(e => e.date === today);
    if (entry) entry.xpEarned += amount;

    saveGameState(gameState);
    checkBadges();
    renderHUD();
    showXPPopup(amount, reason);
}

function checkBadges() {
    let newBadges = [];
    for (const def of BADGE_DEFINITIONS) {
        if (!gameState.badges.includes(def.id) && def.condition(gameState)) {
            gameState.badges.push(def.id);
            newBadges.push(def);
        }
    }
    saveGameState(gameState);
    if (newBadges.length) {
        newBadges.forEach(b => showBadgeToast(b));
        renderBadges();
    }
}

// ============================================================
//  HUD RENDERING
// ============================================================

function renderHUD() {
    const hud = document.getElementById('gamification-hud');
    if (!hud) return;
    const lvl = getCurrentLevel();
    const next = getNextLevel();
    const pct = next
        ? Math.round(((gameState.totalXP - lvl.xpRequired) / (next.xpRequired - lvl.xpRequired)) * 100)
        : 100;
    const streakBonus = gameState.currentStreak * XP_REWARDS.STREAK_BONUS;

    hud.innerHTML = `
        <div class="hud-level">
            <span class="hud-badge-icon">⭐</span>
            <div class="hud-level-info">
                <span class="hud-level-label">Lv. ${lvl.level} · ${lvl.name}</span>
                <div class="hud-xp-bar-wrap">
                    <div class="hud-xp-bar" style="width:${pct}%"></div>
                </div>
                <span class="hud-xp-text">${gameState.totalXP} XP${next ? ` / ${next.xpRequired} XP` : ' · MAX'}</span>
            </div>
        </div>
        <div class="hud-streak">
            <span class="hud-streak-fire">${gameState.currentStreak > 0 ? '🔥' : '💤'}</span>
            <div>
                <div class="hud-streak-num">${gameState.currentStreak}</div>
                <div class="hud-streak-label">Day streak</div>
            </div>
        </div>
    `;
}

function renderBadges() {
    const container = document.getElementById('badges-grid');
    if (!container) return;
    container.innerHTML = '';
    BADGE_DEFINITIONS.forEach(def => {
        const earned = gameState.badges.includes(def.id);
        const el = document.createElement('div');
        el.className = `badge-card ${earned ? 'earned' : 'locked'}`;
        el.title = def.desc;
        el.innerHTML = `
            <div class="badge-icon">${earned ? def.icon : '🔒'}</div>
            <div class="badge-name">${def.name}</div>
            <div class="badge-desc">${def.desc}</div>
        `;
        container.appendChild(el);
    });
}

function renderWeeklyChart() {
    const canvas = document.getElementById('weekly-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth || 280;
    canvas.height = 80;

    // Last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const entry = gameState.weeklyHistory.find(e => e.date === dateStr);
        days.push({ label: d.toLocaleDateString('en', { weekday: 'short' }), xp: entry ? entry.xpEarned : 0 });
    }

    const maxXP = Math.max(...days.map(d => d.xp), 1);
    const barW = Math.floor((canvas.width - 20) / 7);
    const maxH = 50;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    days.forEach((d, i) => {
        const barH = Math.round((d.xp / maxXP) * maxH);
        const x = 10 + i * barW;
        const y = maxH - barH + 10;
        const alpha = d.xp > 0 ? 1 : 0.25;
        ctx.fillStyle = `rgba(99, 179, 237, ${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x + 2, y, barW - 8, barH || 2, 3);
        ctx.fill();

        ctx.fillStyle = 'rgba(160,174,192,0.8)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(d.label, x + barW / 2 - 2, canvas.height - 2);
    });
}

function renderLeaderboard() {
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;

    // Build entries: real player + seeded NPCs
    const playerName = 'You';
    const playerLvl = getCurrentLevel();
    const entries = [
        { name: playerName, xp: gameState.totalXP, level: playerLvl.level, isPlayer: true },
        { name: 'Priya S.', xp: 1240, level: 5, isPlayer: false },
        { name: 'Ahmad K.', xp: 980, level: 4, isPlayer: false },
        { name: 'Maria L.', xp: 760, level: 4, isPlayer: false },
        { name: 'James T.', xp: 530, level: 3, isPlayer: false },
        { name: 'Anika R.', xp: 290, level: 2, isPlayer: false },
    ]
        .sort((a, b) => b.xp - a.xp);

    tbody.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    entries.forEach((e, i) => {
        const tr = document.createElement('tr');
        tr.className = e.isPlayer ? 'lb-player-row' : '';
        tr.innerHTML = `
            <td>${medals[i] || i + 1}</td>
            <td>${e.isPlayer ? '<strong>' + e.name + '</strong>' : e.name}</td>
            <td>Lv. ${e.level}</td>
            <td>${e.xp} XP</td>
        `;
        tbody.appendChild(tr);
    });
}

// ============================================================
//  TOAST NOTIFICATIONS
// ============================================================

function showXPPopup(amount, reason) {
    const popup = document.createElement('div');
    popup.className = 'xp-popup';
    popup.innerHTML = `+${amount} XP <span class="xp-reason">${reason}</span>`;
    document.body.appendChild(popup);
    requestAnimationFrame(() => popup.classList.add('xp-popup-show'));
    setTimeout(() => {
        popup.classList.remove('xp-popup-show');
        setTimeout(() => popup.remove(), 400);
    }, 2000);
}

function showBadgeToast(badge) {
    const toast = document.createElement('div');
    toast.className = 'badge-toast';
    toast.innerHTML = `
        <span class="badge-toast-icon">${badge.icon}</span>
        <div>
            <div class="badge-toast-title">Badge Unlocked!</div>
            <div class="badge-toast-name">${badge.name}</div>
        </div>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('badge-toast-show'));
    setTimeout(() => {
        toast.classList.remove('badge-toast-show');
        setTimeout(() => toast.remove(), 500);
    }, 3500);
}

// ============================================================
//  INJECT GAMIFICATION UI INTO THE PAGE
// ============================================================

function injectGamificationUI() {
    // 1. HUD — inserted into sidebar footer
    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter) {
        const hudEl = document.createElement('div');
        hudEl.id = 'gamification-hud';
        sidebarFooter.insertAdjacentElement('beforebegin', hudEl);
    }

    // 2. Gamification nav item
    const navList = document.querySelector('.nav-links');
    if (navList) {
        const li = document.createElement('li');
        li.setAttribute('data-tab', 'gamification');
        li.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="8" r="7"></circle>
                <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
            </svg>
            <span>My Progress</span>
        `;
        navList.appendChild(li);
    }

    // 3. Gamification view section
    const main = document.querySelector('.content');
    if (main) {
        const section = document.createElement('section');
        section.id = 'gamification-view';
        section.className = 'view';
        section.innerHTML = `
            <header class="view-header">
                <div class="header-badge">Achievements</div>
                <h1>My Civic Progress</h1>
                <p>Track your XP, streaks, badges, and how you rank among fellow civic learners.</p>
            </header>

            <div class="gamification-layout">

                <!-- Left column -->
                <div class="gami-col">
                    <!-- Stats Card -->
                    <div class="gami-card">
                        <h3 class="gami-card-title">📊 Stats Overview</h3>
                        <div class="stats-grid">
                            <div class="stat-item">
                                <div class="stat-value" id="stat-xp">${gameState.totalXP}</div>
                                <div class="stat-label">Total XP</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value" id="stat-streak">${gameState.currentStreak}</div>
                                <div class="stat-label">Current Streak</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value" id="stat-quizzes">${gameState.quizzesCompleted}</div>
                                <div class="stat-label">Quizzes Done</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value" id="stat-badges">${gameState.badges.length}</div>
                                <div class="stat-label">Badges Earned</div>
                            </div>
                        </div>
                    </div>

                    <!-- Weekly XP Chart -->
                    <div class="gami-card">
                        <h3 class="gami-card-title">📈 Weekly XP Activity</h3>
                        <canvas id="weekly-chart" style="width:100%; display:block;"></canvas>
                    </div>

                    <!-- Leaderboard -->
                    <div class="gami-card">
                        <h3 class="gami-card-title">🏆 Leaderboard</h3>
                        <table class="leaderboard-table">
                            <thead>
                                <tr><th>#</th><th>Name</th><th>Level</th><th>XP</th></tr>
                            </thead>
                            <tbody id="leaderboard-body"></tbody>
                        </table>
                    </div>
                </div>

                <!-- Right column: Badges -->
                <div class="gami-col">
                    <div class="gami-card" style="flex:1;">
                        <h3 class="gami-card-title">🎖️ Badges (${gameState.badges.length}/${BADGE_DEFINITIONS.length})</h3>
                        <div id="badges-grid" class="badges-grid"></div>
                    </div>
                </div>

            </div>
        `;
        main.appendChild(section);
    }

    // 4. Wire up tab click
    const allNavLinks = document.querySelectorAll('.nav-links li');
    const allViews = document.querySelectorAll('.view');

    allNavLinks.forEach(link => {
        link.addEventListener('click', () => {
            const tabId = link.getAttribute('data-tab');
            allNavLinks.forEach(n => n.classList.remove('active'));
            link.classList.add('active');
            allViews.forEach(view => {
                view.classList.toggle('active', view.id === `${tabId}-view`);
            });
            if (tabId === 'gamification') {
                refreshGamificationView();
            }
        });
    });
}

function refreshGamificationView() {
    // Refresh stat numbers
    const statXP = document.getElementById('stat-xp');
    const statStreak = document.getElementById('stat-streak');
    const statQuizzes = document.getElementById('stat-quizzes');
    const statBadges = document.getElementById('stat-badges');
    if (statXP) statXP.textContent = gameState.totalXP;
    if (statStreak) statStreak.textContent = gameState.currentStreak;
    if (statQuizzes) statQuizzes.textContent = gameState.quizzesCompleted;
    if (statBadges) statBadges.textContent = gameState.badges.length;

    renderBadges();
    renderLeaderboard();
    setTimeout(renderWeeklyChart, 50); // slight delay for layout
}

// ============================================================
//  INJECT GAMIFICATION STYLES
// ============================================================

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* HUD */
        #gamification-hud {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 14px;
            margin: 0 0 8px 0;
            background: rgba(255,255,255,0.05);
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.08);
        }
        .hud-level { display:flex; align-items:center; gap:8px; flex:1; min-width:0; }
        .hud-badge-icon { font-size: 18px; }
        .hud-level-info { display:flex; flex-direction:column; gap:3px; flex:1; min-width:0; }
        .hud-level-label { font-size:11px; font-weight:600; color: var(--text-primary, #e2e8f0); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .hud-xp-bar-wrap { height:5px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden; }
        .hud-xp-bar { height:100%; background: linear-gradient(90deg, #63b3ed, #9f7aea); border-radius:3px; transition: width 0.5s ease; }
        .hud-xp-text { font-size:10px; color: rgba(160,174,192,0.9); }
        .hud-streak { display:flex; align-items:center; gap:6px; }
        .hud-streak-fire { font-size:18px; }
        .hud-streak-num  { font-size:16px; font-weight:700; color: var(--primary-light, #63b3ed); line-height:1; }
        .hud-streak-label { font-size:9px; color: rgba(160,174,192,0.7); }

        /* XP Popup */
        .xp-popup {
            position:fixed; bottom:80px; right:24px; z-index:9999;
            background: linear-gradient(135deg, #2d3748, #1a202c);
            border: 1px solid #63b3ed;
            color: #63b3ed; font-weight:700; font-size:15px;
            padding: 8px 16px; border-radius:20px;
            box-shadow: 0 4px 20px rgba(99,179,237,0.3);
            opacity:0; transform: translateY(10px);
            transition: opacity 0.3s, transform 0.3s;
            pointer-events:none;
        }
        .xp-popup-show { opacity:1; transform: translateY(0); }
        .xp-reason { font-size:11px; color: rgba(160,174,192,0.8); margin-left:6px; font-weight:400; }

        /* Badge Toast */
        .badge-toast {
            position:fixed; top:20px; right:24px; z-index:9999;
            display:flex; align-items:center; gap:12px;
            background: linear-gradient(135deg, #2d3748, #1a202c);
            border: 1px solid #f6ad55;
            padding: 12px 18px; border-radius: 12px;
            box-shadow: 0 4px 24px rgba(246,173,85,0.3);
            opacity:0; transform: translateX(40px);
            transition: opacity 0.4s, transform 0.4s;
            pointer-events:none;
        }
        .badge-toast-show { opacity:1; transform: translateX(0); }
        .badge-toast-icon { font-size:28px; }
        .badge-toast-title { font-size:11px; color: #f6ad55; text-transform:uppercase; letter-spacing:0.08em; }
        .badge-toast-name  { font-size:15px; font-weight:700; color: #e2e8f0; }

        /* Gamification View Layout */
        .gamification-layout {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            padding: 0 0 40px 0;
        }
        .gami-col {
            flex: 1 1 280px;
            display:flex; flex-direction:column; gap:20px;
        }
        .gami-card {
            background: var(--card-bg, rgba(30,40,58,0.8));
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 14px;
            padding: 20px;
        }
        .gami-card-title {
            font-size:14px; font-weight:600;
            color: var(--text-primary, #e2e8f0);
            margin: 0 0 16px 0;
        }

        /* Stats Grid */
        .stats-grid {
            display: grid; grid-template-columns: 1fr 1fr; gap:12px;
        }
        .stat-item {
            background: rgba(255,255,255,0.04);
            border-radius:10px; padding:12px;
            text-align:center;
        }
        .stat-value { font-size:24px; font-weight:700; color: var(--primary-light, #63b3ed); }
        .stat-label { font-size:11px; color: rgba(160,174,192,0.7); margin-top:2px; }

        /* Badges Grid */
        .badges-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
            gap: 12px;
        }
        .badge-card {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 14px 10px;
            text-align:center;
            cursor: default;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .badge-card.earned {
            border-color: rgba(246,173,85,0.4);
            background: rgba(246,173,85,0.07);
            box-shadow: 0 0 12px rgba(246,173,85,0.1);
        }
        .badge-card.earned:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(246,173,85,0.2);
        }
        .badge-card.locked { opacity: 0.4; filter: grayscale(1); }
        .badge-icon { font-size:26px; margin-bottom:6px; }
        .badge-name { font-size:11px; font-weight:600; color: var(--text-primary, #e2e8f0); margin-bottom:3px; }
        .badge-desc { font-size:10px; color: rgba(160,174,192,0.6); line-height:1.3; }

        /* Leaderboard */
        .leaderboard-table {
            width:100%; border-collapse:collapse; font-size:13px;
        }
        .leaderboard-table th {
            text-align:left; padding:6px 8px;
            font-size:11px; text-transform:uppercase; letter-spacing:0.06em;
            color: rgba(160,174,192,0.6);
            border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .leaderboard-table td {
            padding: 8px;
            border-bottom: 1px solid rgba(255,255,255,0.04);
            color: var(--text-secondary, #a0aec0);
        }
        .lb-player-row td { color: #63b3ed !important; }
        .lb-player-row td strong { color: #63b3ed; }

        /* Quiz XP indicator */
        .quiz-xp-indicator {
            display: inline-flex; align-items:center; gap:6px;
            font-size:12px; color: #63b3ed;
            background: rgba(99,179,237,0.1);
            border: 1px solid rgba(99,179,237,0.25);
            border-radius:20px; padding: 3px 10px;
            margin-left: 10px;
        }
    `;
    document.head.appendChild(style);
}

// ============================================================
//  TRANSLATIONS
// ============================================================

const translations = {
    en: {
        nav_timeline: "Election Timeline",
        nav_explorer: "Constituency Explorer",
        nav_quiz: "Quiz Challenge",
        nav_assistant: "Smart Assistant",
        badge_timeline: "Process Explorer",
        header_timeline_title: "The Election Process",
        header_timeline_desc: "Understand the key steps in democratic elections through our interactive timeline.",
        badge_explorer: "Historical Data",
        header_explorer_title: "Constituency Results",
        header_explorer_desc: "Search for past election results by entering your constituency or area name.",
        badge_quiz: "Knowledge Challenge",
        header_quiz_title: "Test Your Civic Knowledge",
        header_quiz_desc: "Take a dynamic, AI-generated quiz to see how well you understand global election systems.",
        quiz_start_title: "Ready to begin?",
        quiz_start_desc: "The AI will generate 5 random questions. Good luck!",
        btn_start_quiz: "Start Quiz",
        quiz_loading: "Generating your questions...",
        quiz_result_title: "Quiz Complete!",
        btn_restart_quiz: "Play Again",
        opt_loksabha: "Lok Sabha (General Election)",
        opt_vidhansabha: "State Assembly (Vidhan Sabha)",
        btn_search: "Search",
        explorer_empty: "Enter an area above to view historical election results.",
        badge_assistant: "AI Powered",
        header_assistant_title: "Ask the Assistant",
        header_assistant_desc: "Have questions? Ask our AI assistant anything about election processes, voting systems, or civic duties worldwide.",
        assistant_greeting: "Hello! I'm the CivicGuide Assistant. How can I help you understand the election process today?",
        timeline: [
            { date: 'Pre-Election Phase', title: 'Declaring Candidacy & Registration', description: 'Individuals or parties announce their intention to run for office. Simultaneously, eligible citizens must ensure they are registered to vote according to local laws.' },
            { date: 'Campaign Period', title: 'Campaigning & Debates', description: 'Candidates and parties share their platforms, hold rallies, and participate in debates to outline their vision and persuade voters.' },
            { date: 'Pre-Polling', title: 'Candidate Selection (Primaries/Nominations)', description: 'Depending on the system, parties may hold internal elections (like primaries) or nomination processes to select their final candidates for the general election.' },
            { date: 'Election Day(s)', title: 'Polling / Voting', description: 'Citizens cast their ballots at designated polling stations. In some countries, this happens on a single day, while in others (like India), it happens in multiple phases.' },
            { date: 'Post-Election', title: 'Counting & Results', description: 'Votes are counted by the electoral commission or designated authorities. Preliminary and then official results are declared.' },
            { date: 'Final Phase', title: 'Government Formation & Inauguration', description: 'The winning candidates or parties form the new government. Elected officials take their oath of office and officially begin their term.' }
        ]
    },
    hi: {
        nav_timeline: "चुनाव समयरेखा",
        nav_explorer: "निर्वाचन क्षेत्र एक्सप्लोरर",
        nav_quiz: "प्रश्नोत्तरी चुनौती",
        nav_assistant: "स्मार्ट सहायक",
        badge_timeline: "प्रक्रिया एक्सप्लोरर",
        header_timeline_title: "चुनाव प्रक्रिया",
        header_timeline_desc: "हमारे इंटरैक्टिव टाइमलाइन के माध्यम से लोकतांत्रिक चुनावों के प्रमुख चरणों को समझें।",
        badge_explorer: "ऐतिहासिक डेटा",
        header_explorer_title: "निर्वाचन क्षेत्र परिणाम",
        header_explorer_desc: "अपने निर्वाचन क्षेत्र या क्षेत्र का नाम दर्ज करके पिछले चुनाव परिणाम खोजें।",
        badge_quiz: "ज्ञान चुनौती",
        header_quiz_title: "अपने नागरिक ज्ञान का परीक्षण करें",
        header_quiz_desc: "वैश्विक चुनाव प्रणालियों को आप कितनी अच्छी तरह समझते हैं, यह देखने के लिए AI द्वारा उत्पन्न प्रश्नोत्तरी लें।",
        quiz_start_title: "शुरू करने के लिए तैयार हैं?",
        quiz_start_desc: "AI 5 यादृच्छिक प्रश्न उत्पन्न करेगा। शुभकामनाएँ!",
        btn_start_quiz: "प्रश्नोत्तरी शुरू करें",
        quiz_loading: "आपके प्रश्न उत्पन्न हो रहे हैं...",
        quiz_result_title: "प्रश्नोत्तरी पूर्ण!",
        btn_restart_quiz: "फिर से खेलें",
        opt_loksabha: "लोकसभा (आम चुनाव)",
        opt_vidhansabha: "राज्य विधानसभा (विधानसभा)",
        btn_search: "खोजें",
        explorer_empty: "ऐतिहासिक चुनाव परिणाम देखने के लिए ऊपर एक क्षेत्र दर्ज करें।",
        badge_assistant: "AI संचालित",
        header_assistant_title: "सहायक से पूछें",
        header_assistant_desc: "कोई प्रश्न? हमारे AI सहायक से चुनाव प्रक्रियाओं, मतदान प्रणालियों या नागरिक कर्तव्यों के बारे में कुछ भी पूछें।",
        assistant_greeting: "नमस्ते! मैं CivicGuide सहायक हूँ। आज मैं चुनाव प्रक्रिया को समझने में आपकी कैसे मदद कर सकता हूँ?",
        timeline: [
            { date: 'चुनाव पूर्व चरण', title: 'उम्मीदवारी और पंजीकरण', description: 'व्यक्ति या दल चुनाव लड़ने के अपने इरादे की घोषणा करते हैं।' },
            { date: 'अभियान की अवधि', title: 'प्रचार और बहस', description: 'उम्मीदवार और दल अपने विजन को साझा करने के लिए रैलियां करते हैं।' },
            { date: 'मतदान से पहले', title: 'उम्मीदवार चयन', description: 'दल आम चुनाव के लिए अपने अंतिम उम्मीदवारों का चयन करते हैं।' },
            { date: 'चुनाव के दिन', title: 'मतदान', description: 'नागरिक निर्दिष्ट मतदान केंद्रों पर अपना वोट डालते हैं।' },
            { date: 'चुनाव के बाद', title: 'मतगणना और परिणाम', description: 'चुनाव आयोग द्वारा वोटों की गिनती की जाती है।' },
            { date: 'अंतिम चरण', title: 'सरकार गठन और शपथ ग्रहण', description: 'विजेता उम्मीदवार या दल नई सरकार बनाते हैं।' }
        ]
    },
    es: {
        nav_timeline: "Línea de Tiempo",
        nav_assistant: "Asistente Inteligente",
        badge_timeline: "Explorador de Procesos",
        header_timeline_title: "El Proceso Electoral",
        header_timeline_desc: "Comprenda los pasos clave en las elecciones democráticas.",
        badge_assistant: "Impulsado por IA",
        header_assistant_title: "Pregunta al Asistente",
        header_assistant_desc: "¿Tienes preguntas? Pregúntale a nuestro asistente de IA.",
        assistant_greeting: "¡Hola! Soy el Asistente de CivicGuide. ¿Cómo puedo ayudarte?",
        timeline: [
            { date: 'Fase Pre-Electoral', title: 'Declaración de Candidatura', description: 'Individuos o partidos anuncian su intención de postularse.' },
            { date: 'Período de Campaña', title: 'Campaña y Debates', description: 'Los candidatos comparten sus plataformas.' },
            { date: 'Pre-Votación', title: 'Selección de Candidatos', description: 'Los partidos eligen a sus candidatos finales.' },
            { date: 'Día de Elecciones', title: 'Votación', description: 'Los ciudadanos emiten sus votos.' },
            { date: 'Post-Elección', title: 'Conteo y Resultados', description: 'Los votos son contados por las autoridades.' },
            { date: 'Fase Final', title: 'Formación de Gobierno', description: 'Los ganadores forman el nuevo gobierno.' }
        ]
    },
    fr: {
        nav_timeline: "Chronologie Électorale",
        nav_assistant: "Assistant Intelligent",
        badge_timeline: "Explorateur de Processus",
        header_timeline_title: "Le Processus Électoral",
        header_timeline_desc: "Comprenez les étapes clés des élections démocratiques.",
        badge_assistant: "Propulsé par l'IA",
        header_assistant_title: "Demandez à l'Assistant",
        header_assistant_desc: "Des questions ? Demandez à notre assistant IA.",
        assistant_greeting: "Bonjour ! Je suis l'Assistant CivicGuide. Comment puis-je vous aider ?",
        timeline: [
            { date: 'Phase Préélectorale', title: 'Déclaration de Candidature', description: 'Les individus ou partis annoncent leur candidature.' },
            { date: 'Période de Campagne', title: 'Campagne et Débats', description: 'Les candidats partagent leurs programmes.' },
            { date: 'Pré-Vote', title: 'Sélection des Candidats', description: 'Les partis choisissent leurs candidats.' },
            { date: "Jour d'Élection", title: 'Vote', description: 'Les citoyens déposent leurs bulletins.' },
            { date: 'Post-Élection', title: 'Dépouillement et Résultats', description: 'Les votes sont comptés.' },
            { date: 'Phase Finale', title: 'Formation du Gouvernement', description: 'Les gagnants forment le nouveau gouvernement.' }
        ]
    }
};

// ============================================================
//  DOM ELEMENTS
// ============================================================

const timelineStepsContainer = document.getElementById('timeline-steps');
const navLinks = document.querySelectorAll('.nav-links li');
const views = document.querySelectorAll('.view');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const chatHistory = document.getElementById('chat-history');

const explorerConstituency = document.getElementById('explorer-constituency');
const explorerType = document.getElementById('explorer-type');
const explorerBtn = document.getElementById('explorer-btn');
const explorerResults = document.getElementById('explorer-results');

// Quiz Elements — resolved lazily inside DOMContentLoaded
let quizStartBox, quizLoadingBox, quizQuestionBox, quizResultsBox;
let btnStartQuiz, btnNextQuestion, btnRestartQuiz;
let quizQuestionText, quizOptionsDiv, quizCounter, quizScoreEl, quizFeedback, quizFinalScore, quizResultMsg;

// ============================================================
//  TIMELINE
// ============================================================

function renderTimeline() {
    timelineStepsContainer.innerHTML = '';
    const timelineData = translations[currentLanguage]?.timeline || translations.en.timeline;
    timelineData.forEach((step, index) => {
        const stepEl = document.createElement('div');
        stepEl.className = 'timeline-step';
        stepEl.style.animationDelay = `${index * 0.15}s`;
        stepEl.innerHTML = `
            <div class="step-marker"><div class="step-dot"></div></div>
            <div class="step-content">
                <div class="step-date">${step.date}</div>
                <h3 class="step-title">${step.title}</h3>
                <p class="step-desc">${step.description}</p>
            </div>`;
        timelineStepsContainer.appendChild(stepEl);
    });
}

// ============================================================
//  CHAT ASSISTANT
// ============================================================

function addMessage(text, isUser = false, isMarkdown = false) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${isUser ? 'user-msg' : 'system-msg'}`;
    const avatarHtml = isUser
        ? `<div class="avatar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`
        : `<div class="avatar"><div class="logo-icon small" style="width:20px;height:20px;border-radius:4px;"></div></div>`;
    const contentHtml = (isMarkdown && typeof marked !== 'undefined') ? marked.parse(text) : text;
    msgEl.innerHTML = `${avatarHtml}<div class="bubble">${contentHtml}</div>`;
    chatHistory.appendChild(msgEl);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function showTypingIndicator() {
    const indicatorId = 'typing-' + Date.now();
    const msgEl = document.createElement('div');
    msgEl.className = 'message system-msg';
    msgEl.id = indicatorId;
    msgEl.innerHTML = `
        <div class="avatar"><div class="logo-icon small" style="width:20px;height:20px;border-radius:4px;"></div></div>
        <div class="bubble"><div class="typing-indicator">
            <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
        </div></div>`;
    chatHistory.appendChild(msgEl);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return indicatorId;
}

async function callGeminiAPI(prompt, isJsonMode = false) {
    try {
        const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, isJsonMode, language: currentLanguage })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        const data = await response.json();
        return data.text ?? "Sorry, I received an unexpected response format.";
    } catch (error) {
        return `⚠️ **Error**: ${error.message}`;
    }
}

async function handleSend() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.disabled = true;
    sendBtn.disabled = true;
    addMessage(text, true);
    chatInput.value = '';
    const typingId = showTypingIndicator();
    const typingEl = document.getElementById(typingId);
    try {
        const responseText = await callGeminiAPI(text);
        if (typingEl) typingEl.remove();
        addMessage(responseText, false, true);
    } catch (e) {
        if (typingEl) typingEl.remove();
        addMessage("Sorry, something went wrong.", false);
    } finally {
        chatInput.disabled = false;
        sendBtn.disabled = false;
        chatInput.focus();
    }
}

// ============================================================
//  UI LANGUAGE
// ============================================================

function updateUILanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const lang = translations[currentLanguage] || translations.en;
        if (lang[key]) el.innerHTML = lang[key];
    });
    const ch = document.getElementById('chat-history');
    if (ch && ch.children.length === 1) {
        const bubble = ch.querySelector('.system-msg .bubble');
        const lang = translations[currentLanguage] || translations.en;
        if (bubble && lang.assistant_greeting) bubble.innerHTML = lang.assistant_greeting;
    }
}

// ============================================================
//  EXPLORER
// ============================================================

if (explorerBtn) {
    explorerBtn.addEventListener('click', async () => {
        const constituency = explorerConstituency.value.trim();
        const type = explorerType.options[explorerType.selectedIndex].text;
        if (!constituency) return;
        explorerBtn.disabled = true;
        explorerResults.innerHTML = `<div class="empty-state"><div class="typing-indicator" style="justify-content:center;"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
        const prompt = `Act as an election data historian. Provide the detailed election results for the last two elections for the constituency '${constituency}' in the '${type}'. Include the Year, Winning Candidate, Runner-up, their Political Parties, and Vote Margins. You MUST format this data strictly as a Markdown table. Do not include extra conversational text.`;
        const responseText = await callGeminiAPI(prompt);
        explorerResults.innerHTML = (typeof marked !== 'undefined') ? marked.parse(responseText) : `<pre>${responseText}</pre>`;

        // Award XP for searching
        gameState.constituencySearches = (gameState.constituencySearches || 0) + 1;
        saveGameState(gameState);
        awardXP(XP_REWARDS.CONSTITUENCY_SEARCH, 'Constituency searched');
        checkBadges();

        explorerBtn.disabled = false;
    });
}

// ============================================================
//  QUIZ — GAMIFICATION INTEGRATED
// ============================================================

let quizQuestions = [];
let currentQuizIndex = 0;
let currentScore = 0;
let questionStartTime = null;  // for fast-answer detection (< 8 seconds)

async function generateQuiz() {
    quizStartBox.style.display = 'none';
    quizResultsBox.style.display = 'none';
    quizLoadingBox.style.display = 'block';

    const prompt = `You are a gamemaster. Generate 5 multiple-choice trivia questions about world elections and democratic systems. Return the output STRICTLY as a JSON array of objects. Do not wrap in markdown or backticks. The array should look exactly like this:
    [
      {
        "question": "The text of the question",
        "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
        "correctIndex": 0,
        "explanation": "Brief explanation of the correct answer."
      }
    ]
    IMPORTANT: Provide the questions and text in ${currentLanguage === 'hi' ? 'Hindi' : 'English'}.`;

    try {
        const responseText = await callGeminiAPI(prompt, true);
        if (responseText.startsWith("⚠️")) throw new Error(responseText);
        const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        quizQuestions = JSON.parse(cleaned);
        currentQuizIndex = 0;
        currentScore = 0;
        quizLoadingBox.style.display = 'none';
        quizQuestionBox.style.display = 'block';
        renderQuizQuestion();
    } catch (e) {
        console.error("Quiz parsing error:", e);
        quizLoadingBox.style.display = 'none';
        quizStartBox.style.display = 'block';
        alert(`Failed to generate quiz: ${e.message}`);
    }
}

function renderQuizQuestion() {
    if (currentQuizIndex >= quizQuestions.length) { showQuizResults(); return; }
    const q = quizQuestions[currentQuizIndex];
    const xpPerQ = XP_REWARDS.CORRECT_ANSWER;
    quizCounter.innerHTML = `Question ${currentQuizIndex + 1} of ${quizQuestions.length} <span class="quiz-xp-indicator">⚡ +${xpPerQ} XP per correct</span>`;
    quizScoreEl.innerText = `Score: ${currentScore}`;
    quizQuestionText.innerText = q.question;
    quizOptionsDiv.innerHTML = '';
    quizFeedback.style.display = 'none';
    btnNextQuestion.style.display = 'none';
    questionStartTime = Date.now();

    q.options.forEach((opt, index) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-opt-btn';
        btn.innerText = opt;
        btn.onclick = () => handleQuizAnswer(index, btn);
        quizOptionsDiv.appendChild(btn);
    });
}

function handleQuizAnswer(selectedIndex, btnElement) {
    const q = quizQuestions[currentQuizIndex];
    const isCorrect = (selectedIndex === q.correctIndex);
    const elapsed = (Date.now() - questionStartTime) / 1000;
    const allBtns = quizOptionsDiv.querySelectorAll('.quiz-opt-btn');
    allBtns.forEach(b => b.disabled = true);

    if (isCorrect) {
        btnElement.classList.add('correct');
        currentScore++;
        quizScoreEl.innerText = `Score: ${currentScore}`;
        quizFeedback.style.borderLeftColor = '#22c55e';
        quizFeedback.innerHTML = `<strong>Correct!</strong> ${q.explanation}`;

        // Award XP for correct answer
        awardXP(XP_REWARDS.CORRECT_ANSWER, 'Correct answer');

        // Fast answer tracking
        if (elapsed < 8) {
            gameState.fastAnswers = (gameState.fastAnswers || 0) + 1;
            saveGameState(gameState);
            checkBadges();
        }
    } else {
        btnElement.classList.add('incorrect');
        allBtns[q.correctIndex].classList.add('correct');
        quizFeedback.style.borderLeftColor = '#ef4444';
        quizFeedback.innerHTML = `<strong>Incorrect.</strong> ${q.explanation}`;
    }

    quizFeedback.style.display = 'block';
    btnNextQuestion.style.display = 'block';
}

function showQuizResults() {
    quizQuestionBox.style.display = 'none';
    quizResultsBox.style.display = 'block';
    quizFinalScore.innerText = `${currentScore}/${quizQuestions.length}`;

    // Update quiz stats
    gameState.quizzesCompleted = (gameState.quizzesCompleted || 0) + 1;
    if (currentScore === quizQuestions.length) {
        gameState.perfectScores = (gameState.perfectScores || 0) + 1;
        awardXP(XP_REWARDS.PERFECT_QUIZ, 'Perfect score bonus!');
    }
    awardXP(XP_REWARDS.QUIZ_COMPLETE, 'Quiz completed');
    saveGameState(gameState);
    checkBadges();

    // Message
    const pct = currentScore / quizQuestions.length;
    if (pct === 1) quizResultMsg.innerText = "Flawless! You are a true civic expert. 🏆";
    else if (pct >= 0.6) quizResultMsg.innerText = "Great job! You really know your stuff. 👍";
    else quizResultMsg.innerText = "Good try! Check out the Election Timeline to learn more. 📚";

    // Show XP summary on result screen
    const streakBonus = gameState.currentStreak * XP_REWARDS.STREAK_BONUS;
    const summaryEl = document.createElement('div');
    summaryEl.style.cssText = 'font-size:13px; color: rgba(160,174,192,0.7); margin-top:8px;';
    summaryEl.innerHTML = `🔥 Streak bonus: +${streakBonus} XP &nbsp;|&nbsp; 💎 Total XP: ${gameState.totalXP}`;
    // Remove old summary if any
    const old = quizResultsBox.querySelector('.xp-summary');
    if (old) old.remove();
    summaryEl.className = 'xp-summary';
    quizResultMsg.after(summaryEl);

    renderHUD();
}

// Quiz event listeners wired inside DOMContentLoaded below

// ============================================================
//  GENERAL EVENT WIRING
// ============================================================

sendBtn.addEventListener('click', handleSend);
chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleSend(); });

const btnScenario = document.getElementById('btn-scenario');
if (btnScenario) {
    btnScenario.addEventListener('click', () => {
        chatInput.value = "START A ROLEPLAY SCENARIO";
        handleSend();
    });
}

const langSelector = document.getElementById('language-selector');
if (langSelector) {
    langSelector.addEventListener('change', e => {
        currentLanguage = e.target.value;
        updateUILanguage();
        renderTimeline();
    });
}

// Nav tab wiring is handled entirely inside injectGamificationUI (DOMContentLoaded)

// ============================================================
//  INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // Resolve quiz elements now that DOM is ready
    quizStartBox = document.getElementById('quiz-start');
    quizLoadingBox = document.getElementById('quiz-loading');
    quizQuestionBox = document.getElementById('quiz-question-box');
    quizResultsBox = document.getElementById('quiz-results');
    btnStartQuiz = document.getElementById('btn-start-quiz');
    btnNextQuestion = document.getElementById('btn-next-question');
    btnRestartQuiz = document.getElementById('btn-restart-quiz');
    quizQuestionText = document.getElementById('quiz-question-text');
    quizOptionsDiv = document.getElementById('quiz-options');
    quizCounter = document.getElementById('quiz-counter');
    quizScoreEl = document.getElementById('quiz-score');
    quizFeedback = document.getElementById('quiz-feedback');
    quizFinalScore = document.getElementById('quiz-final-score');
    quizResultMsg = document.getElementById('quiz-result-msg');

    // Wire quiz buttons
    if (btnStartQuiz) btnStartQuiz.addEventListener('click', generateQuiz);
    if (btnRestartQuiz) btnRestartQuiz.addEventListener('click', generateQuiz);
    if (btnNextQuestion) btnNextQuestion.addEventListener('click', () => { currentQuizIndex++; renderQuizQuestion(); });

    injectStyles();
    injectGamificationUI();   // injects gamification nav + section, wires ALL nav tabs
    updateUILanguage();
    renderTimeline();
    renderHUD();
    markActiveToday();
    checkBadges();
});