# CivicGuide — AI Election Assistant

An interactive, AI-powered web app that helps users understand election processes, explore constituency results, test their civic knowledge, and track their learning progress — all in one place.

---

## Features

### 🗳️ Election Timeline
A visual, step-by-step breakdown of the democratic election process — from candidate registration through to government formation.

### 🔭 Constituency Explorer
Enter any constituency name to retrieve AI-generated historical election results, winning candidates, vote margins, and party breakdowns in a clean markdown table.

### 🧠 Quiz Challenge
AI-generated 5-question multiple choice quizzes on global election systems. Every quiz is unique. Instant feedback and explanations after each answer.

### 💬 Smart Assistant
A Gemini-powered chat assistant that answers questions about elections, voting systems, and civic duties worldwide. Supports roleplay scenarios (e.g. "you are a polling station worker...").

### 🏆 Gamification System
- **XP & Levels** — Earn XP for correct answers, completed quizzes, and constituency searches. Progress through 6 named levels from *Citizen* to *Civic Legend*
- **Daily Streaks** — Stay active daily to build and maintain streaks
- **Badges** — 10 unlockable badges including *Flawless Voter*, *Speed Demon*, and *Civic Champion*
- **Leaderboard** — See how you rank against other civic learners
- **Weekly Activity Chart** — Visual bar chart of your XP earned over the past 7 days

### 🌐 Multi-language Support
Full UI and AI responses in English, Hindi, Spanish, and French.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| AI | Google Gemini 2.5 Flash API |
| Backend | Python `http.server` (stdlib only) |
| Deployment | Google Cloud Run + Docker |
| Secret Management | Google Cloud Secret Manager |

---

## Project Structure

```
election-assistant/
|
│ index.html        # App shell and layout
│ app.js            # All frontend logic + gamification
│ styles.css        # Styles
| server.py             # Python proxy server (hides API key)
| Dockerfile            # Container config for Cloud Run
```

---

## Local Development

**Prerequisites:** Python 3.8+, a Gemini API key

```bash
# Clone the repo
git clone https://github.com/your-username/civicguide.git
cd civicguide

# Set your API key and start the server
# macOS / Linux
GEMINI_API_KEY=your_key_here python server.py

# Windows
set GEMINI_API_KEY=your_key_here && python server.py
```

Open [http://localhost:8080](http://localhost:8080)

> **Note:** If your static files sit alongside `server.py` (not inside `public/`), the server detects this automatically and serves from the current directory.

---

## Deploying to Google Cloud Run

### 1. Store your API key securely

```bash
echo -n "your_actual_key" | gcloud secrets create gemini-api-key --data-file=-
```

### 2. Build and push the Docker image

```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/civicguide
```

### 3. Deploy

```bash
gcloud run deploy civicguide \
  --image gcr.io/YOUR_PROJECT_ID/civicguide \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

The API key is injected at runtime by Cloud Run — it never appears in source code, Docker images, or logs.

---

## Security

- The Gemini API key is stored exclusively as a Google Cloud Secret Manager secret
- The Python proxy server (`server.py`) holds the key server-side — the browser only ever calls `/api/gemini` on your own domain
- No API keys are present anywhere in the frontend code

---

## Gamification XP Reference

| Action | XP Earned |
|---|---|
| Correct quiz answer | +20 XP |
| Complete a quiz | +15 XP |
| Perfect score (5/5) | +50 XP bonus |
| Search a constituency | +10 XP |
| Active streak bonus | +5 XP/day |

---

## License

MIT
