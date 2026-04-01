# TISUNGA Backend API (JavaScript)

> A smarter and safer way for communities to save, grow, and manage money together.

REST API for **TISUNGA** — a community savings, loans, and events platform built for Malawi.
Built with **plain JavaScript** (Node.js + Express), no TypeScript required.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Express.js |
| Database | PostgreSQL 16 (via Prisma ORM) |
| Cache | Redis 7 |
| Auth | JWT + bcryptjs |
| SMS / OTP | Africa's Talking |
| Payments | Airtel Money / TNM Mpamba |
| Push | Firebase Cloud Messaging |
| Docs | Swagger / OpenAPI 3.0 |
| CI/CD | GitHub Actions + Docker |

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/your-org/tisunga-backend.git
cd tisunga-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — fill in your DB, Redis, SMS and payment keys
```

### 3. Start services

```bash
docker compose up postgres redis -d
```

### 4. Run migrations & seed data

```bash
npx prisma migrate dev
node prisma/seed.js
```

### 5. Start dev server

```bash
npm run dev
# API → http://localhost:3000
# Docs → http://localhost:3000/api-docs
```

---

## Project Structure

```
tisunga-backend/
├── prisma/
│   ├── schema.prisma          ← Full DB schema
│   └── seed.js                ← Dev seed (users, groups, loans, events)
├── src/
│   ├── index.js               ← Entry point
│   ├── app.js                 ← Express app & middleware
│   ├── config/
│   │   ├── prisma.js          ← Prisma client
│   │   ├── redis.js           ← Redis connection
│   │   └── swagger.js         ← OpenAPI spec
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── user.controller.js
│   │   ├── group.controller.js
│   │   ├── contribution.controller.js
│   │   ├── loan.controller.js
│   │   ├── event.controller.js
│   │   ├── notification.controller.js
│   │   ├── transaction.controller.js
│   │   └── webhook.controller.js
│   ├── middleware/
│   │   ├── authenticate.js    ← JWT + role guards
│   │   ├── rateLimiter.js
│   │   ├── errorHandler.js
│   │   └── notFound.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── group.routes.js
│   │   ├── contribution.routes.js
│   │   ├── loan.routes.js
│   │   ├── event.routes.js
│   │   ├── notification.routes.js
│   │   ├── transaction.routes.js
│   │   └── webhook.routes.js
│   ├── services/
│   │   ├── sms.service.js         ← Africa's Talking
│   │   ├── payment.service.js     ← Airtel Money / Mock
│   │   ├── notification.service.js← FCM push
│   │   └── transaction.service.js ← Central ledger
│   ├── jobs/
│   │   ├── index.js               ← Cron scheduler
│   │   ├── loanDueAlert.job.js    ← Overdue + reminders
│   │   └── eventStatus.job.js     ← UPCOMING→ACTIVE→CLOSED
│   ├── utils/
│   │   ├── helpers.js             ← Phone, OTP, refs, maths
│   │   ├── jwt.js                 ← Sign / verify tokens
│   │   ├── AppError.js            ← AppError + response helpers
│   │   └── logger.js              ← Winston logger
│   └── __tests__/
│       ├── helpers.test.js
│       ├── jwt.test.js
│       ├── loan.test.js
│       └── auth.test.js
├── .env.example
├── .eslintrc.js
├── nodemon.json
├── .gitignore
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---

## API Endpoints

All endpoints are prefixed with `/api/v1`.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register with Malawi phone number |
| POST | `/auth/verify-otp` | Verify SMS OTP |
| POST | `/auth/resend-otp` | Resend OTP |
| POST | `/auth/set-password` | Set password after verification |
| POST | `/auth/login` | Login → access + refresh tokens |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/forgot-password` | Initiate password reset |
| POST | `/auth/reset-password` | Complete password reset |
| POST | `/auth/logout` | Invalidate refresh token |

### Users
| Method | Path | Description |
|---|---|---|
| GET | `/users/me` | Own profile + group memberships |
| PATCH | `/users/me` | Update name / FCM token |
| PATCH | `/users/me/avatar` | Upload avatar (multipart) |
| GET | `/users/me/loans` | My loan history |
| GET | `/users/me/contributions` | My contribution history |

### Groups
| Method | Path | Description |
|---|---|---|
| POST | `/groups` | Create group (creator becomes Chair) |
| GET | `/groups/discover` | Search public groups |
| GET | `/groups/my` | My active groups |
| POST | `/groups/join` | Join by group code |
| GET | `/groups/:id` | Group details |
| PATCH | `/groups/:id` | Edit group (Chair) |
| GET | `/groups/:id/dashboard` | Savings, loans, events summary |
| GET | `/groups/:id/members` | Member list |
| PATCH | `/groups/:id/members/:uid` | Change role / status (Chair) |
| DELETE | `/groups/:id/members/:uid` | Remove member (Chair) |
| GET | `/groups/:id/join-requests` | Pending requests (Chair/Secretary) |
| PATCH | `/groups/:id/join-requests/:rid` | Approve / Reject |
| GET | `/groups/:id/contributions` | Contribution history |
| GET | `/groups/:id/loans` | Loan list |
| GET | `/groups/:id/transactions` | Full transaction ledger |
| GET | `/groups/:id/events` | Events list |
| POST | `/groups/:id/events` | Create event (Chair/Secretary) |

### Contributions
| Method | Path | Description |
|---|---|---|
| POST | `/contributions` | Make a savings contribution (mobile money) |

### Loans
| Method | Path | Description |
|---|---|---|
| POST | `/loans/apply` | Apply for a group loan |
| GET | `/loans/my` | My loans with % repaid |
| PATCH | `/loans/:id/approve` | Approve & disburse (Chair/Secretary) |
| PATCH | `/loans/:id/reject` | Reject application |
| POST | `/loans/:id/repay` | Make a repayment |

### Events
| Method | Path | Description |
|---|---|---|
| GET | `/events/:id` | Event details + contributions |
| POST | `/events/:id/contribute` | Contribute to an event |

### Notifications
| Method | Path | Description |
|---|---|---|
| GET | `/notifications` | Feed with unread count |
| PATCH | `/notifications/read-all` | Clear all badges |
| PATCH | `/notifications/:id/read` | Mark one read |

### Webhooks *(internal)*
| Method | Path | Description |
|---|---|---|
| POST | `/webhooks/payment` | Generic HMAC-signed callback |
| POST | `/webhooks/airtel` | Airtel Money specific callback |

---

## Roles & Permissions

| Action | CHAIR | SECRETARY | MEMBER |
|---|---|---|---|
| Approve / Reject loans | ✅ | ✅ | ❌ |
| Manage members | ✅ | ❌ | ❌ |
| Approve join requests | ✅ | ✅ | ❌ |
| Create events | ✅ | ✅ | ❌ |
| Contribute / Apply loans | ✅ | ✅ | ✅ |

---

## Phone Number Format

Accepts any of these formats (Malawi +265):

```
0882752624    →  +265882752624
265882752624  →  +265882752624
+265882752624 →  +265882752624  (used as-is)
```

Valid prefixes: `088`, `089`, `097`, `099`

---

## Running Tests

```bash
npm test                  # all tests
npm run test:coverage     # with coverage report
```

---

## Production Deployment

```bash
docker compose up -d                    # start all services
docker compose run --rm migrate         # run migrations + seed
```

---

## Seed Credentials

After running `node prisma/seed.js`:

| Name | Phone | Password | Role |
|---|---|---|---|
| Michael Enock | +265882752624 | Password123! | Member (Doman Group) |
| Laston Mzumala | +265997486222 | Password123! | Chair (Doman Group) |

---

*Built for TISUNGA — Malawi's community savings platform.*
