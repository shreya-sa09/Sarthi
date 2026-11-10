# Sarthi — Voice Co-Pilot for Delivery Riders

## Problem

Delivery riders manage a high volume of small tasks between stops: checking addresses and access notes, contacting customers, reporting exceptions, and updating order status. Each task pulls attention away from the road and requires screen navigation and typing. Over a long shift, that friction can lead to missed updates, unresolved delivery issues, and delayed customer communication.

## Solution

Sarthi is a voice-first co-pilot for e-commerce delivery riders. Riders speak naturally in supported Indian languages and code-mixed speech; Sarthi interprets the request, opens the right workflow, and speaks the result. Deterministic backend rules validate delivery-state changes. The language model interprets requests but cannot independently mark an order delivered; completion requires a matching OTP.

## Key Features

- **Run and stop overview** — review assigned stops, the current delivery, and run progress.
- **Spoken route guidance** — use live device location, map routes, and spoken turn instructions.
- **Voice-driven delivery support** — record customer-unreachable, address, and rescheduling issues through guided workflows.
- **OTP-gated completion** — complete a delivery only after the backend verifies its OTP.
- **Customer-call shortcut** — open the rider’s device dialer for the saved customer number; Sarthi does not simulate or place calls itself.
- **Activity timeline** — review delivery updates and recorded actions.

## Technology

Sarthi uses **Gnani Prisma** for speech-to-text and **Gnani Timbre** for spoken responses. A **Groq-hosted GPT-OSS** model interprets rider requests and proposes workflows. The frontend uses React and TypeScript; the backend uses Python and FastAPI. Backend validation controls every delivery-state transition, keeping sensitive actions outside the language model.

## Prototype Scope

The repository includes fictional seeded delivery records for development and evaluation. They are sample data, not live customer or dispatch records. The prototype is not connected to a production logistics platform or live dispatch feed. Customer calls use the device dialer and require the rider to initiate the call.

## Product Screens

The following mobile UI captures show the welcome screen, run overview, delivery queue, map, and activity timeline. Screens showing sample orders use fictional seeded data.

| Welcome | Run overview |
| --- | --- |
| ![Sarthi welcome screen](docs/screenshots/welcome.png) | ![Sarthi run overview with fictional sample data](docs/screenshots/home.png) |

| Delivery queue | Route navigation |
| --- | --- |
| ![Sarthi delivery queue with fictional sample data](docs/screenshots/deliveries.png) | ![Sarthi map and navigation screen](docs/screenshots/navigation.png) |

![Sarthi activity timeline using sample data](docs/screenshots/activity.png)

## Run Locally

Backend (from `backend/`):

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

Frontend (from `frontend/`):

```powershell
npm install
npm run dev
```

Set Gnani, Groq, and GraphHopper credentials in `backend/.env` only. Never put API keys in frontend code or commit them.
