# Gym Management App: Design

*Status: approved 2026-11-15 · Dimitris Vlachogiannis*

## 1. Intent

A friend of Dimitris is opening a new gym in about six months. This app will be the gym's operating system from day one: memberships, payments recorded at the desk, check-in, staff shifts, trainer assignments, workout plans and member progress. There is no legacy system or existing data.

The app must be designed from the start to host **many gyms**. Later, other gym owners should be able to register and run their gym independently on the same platform.

## 2. Goals, non-goals, anti-goals

**Goals**
- A complete, reliable system that is ready and tested with real people before opening day.
- Fast front-desk flow: a member scans in and reception immediately sees whether they're valid.
- Trainers can build plans quickly. Members can log workouts easily and see their progress.
- Multi-gym ready, with no rewrite needed to onboard a second gym.

**Non-goals (for now)**
- Online payments (payments are cash or card at the desk; the app only records them).
- Messaging between trainers and members.
- Door or turnstile hardware integration (reception is always staffed).
- Native App Store / Play Store apps (possible later; see §4).

**Anti-goals (would be a failure even if it "works")**
- One gym can ever see another gym's data.
- Check-in is slower than a paper list at the desk.
- Members miss expiry reminders because they didn't install the app.
- Personal and health data handled carelessly. The gym is in the EU, so GDPR applies.

## 3. Constraints
- Development runs locally first (Docker). Deployment is decided once the app works.
- Greek and English UI from the start.
- Time zone per gym (first gym: Europe/Athens). Timestamps are stored in UTC.
- About six months until opening, including a pilot period with the owner and test members.

## 4. Approaches considered

**Client**
| Option | Trade-off |
|---|---|
| **A. One installable web app (PWA) for all roles** ✅ chosen | One codebase, no store fees or reviews. On iPhone, push only works after "Add to Home Screen" via Safari (iOS 16.4+). |
| B. Web app for staff + React Native/Expo store app for members | Most reliable push and the most native feel, but two front ends, store accounts and roughly double the member-side work. |

Chosen: **A, built so that B can be added later.** All business logic lives in the API, and the web client only displays it. Membership reminders are also sent **by email**, so members who never install the app are still covered.

**Server language**
| Option | Trade-off |
|---|---|
| **TypeScript: React + NestJS** ✅ chosen | One language end to end, builds on Dimitris's Node/Express experience, NestJS gives structure (modules, guards). |
| Python: FastAPI + React | Familiar, good for future ML features, but two languages. |
| Java: Spring Boot + React | Most established for enterprise software, but slower to build and heavier to run. |

**Database:** **PostgreSQL** ✅ chosen over MongoDB. The data is relational, payments need transactions, and Row-Level Security enforces per-gym isolation inside the database.

## 5. Users and permissions

A person signs in once. Their **role is per gym**, so one person can hold several roles (for example, the owner is also a trainer) and could later belong to more than one gym.

| Capability | Platform admin | Owner | Reception | Trainer | Member |
|---|---|---|---|---|---|
| Create gyms, platform settings | ✅ | | | | |
| Gym settings, membership types, prices | | ✅ | | | |
| See all members and memberships | | ✅ | ✅ | | |
| Issue sign-up codes, confirm new members, record payments, freeze | | ✅ | ✅ | | |
| Assign a trainer to a member, assign cover | | ✅ | ✅ | | |
| Live check-ins, who's in, today's visitors | | ✅ | ✅ | ✅ | |
| Manage staff and shifts | | ✅ | (view) | own (view) | |
| Owner dashboard, payments history, change history | | ✅ | | | |
| Build plans, templates, record measurements | | | | own clients | |
| Check in, view plan, log workouts, charts | | | | | ✅ |
| Book group classes | | | | | ✅ |

*The owner can do everything reception can.* The **Platform admin** is Dimitris, as the operator of the platform.

## 6. Features

### 6.0 Member sign-up (decided 2026-11-16)
- Members create their own account on their phone, but only with a **one-time sign-up code** that reception generates at the desk (prevents spam and bot accounts).
- Reception presses "New member code". The app shows a code (8 characters, easy to read aloud, valid 24 hours, single use, tied to the gym).
- The member opens the app, enters the code and their details. **Required:** first name, last name, email, mobile phone, date of birth, password, acceptance of the privacy notice. **Optional:** emergency contact (name + phone).
- The member gets an email to confirm their address. Reception sees whether the email is confirmed.
- New sign-ups appear on reception's screen as "New, no membership yet". Reception checks the person in front of them and sells the first membership.
- An email that already has an account (e.g. a member of another gym) is linked, not duplicated: the person signs in with their existing password and the code adds the member role.
- The member photo is optional and is taken later by reception with the tablet camera (with the check-in work).
- Staff (owner, reception, trainers) are still added by email invitation.

### 6.1 Memberships and payments
- **Membership types** (owner-defined, per gym):
  - **Time-based**: e.g. 1 / 3 / 12 months.
  - **Visit pack**: e.g. 10 visits, with an optional validity period.
  - **Day pass**: 1 visit, valid that day.
  - **Class pack**: e.g. 12 group classes, with an optional validity period.
- Each type has a price and optional rules: max freeze days, plus two switches the owner can set freely:
  - **Includes personal trainer**: only members whose active membership has this switch on can be assigned a trainer and get plans.
  - **Includes group classes**: members can book classes. A class pack counts down one per booking attended.
- This supports any pricing model: everything included, personal training as a paid add-on, or classes priced separately. The owner decides later without code changes.
- A member may hold **more than one active membership at once** (e.g. a 1-month gym membership plus a class pack). Their rights are the combination of all active ones.
- **Selling / renewing**: reception picks the member and type, records the payment (amount, cash/card, date, who recorded it), and the membership is created. An early renewal starts the day after the current one ends.
- **Freeze**: reception sets a freeze period (start/end). The time-based end date moves forward by the frozen days, up to the type's maximum.
- **Remaining time**: members see days left (or visits left) prominently.
- **Renewals list**: memberships expiring in the next 7 days, and visit packs with 2 or fewer visits left, shown to reception.
- **Reminders**: email plus push N days before expiry (gym setting, default 5) and again on the expiry day. Visit packs get a reminder at 2 visits left.

### 6.2 Check-in
- Each member's app shows a **personal QR code**. It is a short-lived signed token that refreshes about every 30 s, so screenshots can't be shared.
- A **tablet at reception** runs the *Kiosk* screen, signed in as a gym device, and scans the member's QR with its camera.
- The tablet shows a friendly result ("Welcome, Maria"). The **receptionist's computer** updates live with the member's photo, name, membership status, and a clear red warning if expired, frozen or out of visits.
- Check-in still records the visit when the membership is invalid, flagged, so reception can resolve it. A visit pack's visit is used up only on a valid check-in.
- **Fallback**: reception can search a member by name and check them in by hand (phone dead, no app).
- **Who's in now**: anyone who checked in within the last X hours (gym setting, default 2 h). Staff can check someone out by hand. There is no explicit check-out for members.
- **Occupancy**: members see a live "how busy is it now" indicator (count, or quiet/moderate/busy).

### 6.3 Staff and shifts
- The owner manages staff accounts and roles.
- The owner (or reception, if allowed) creates **shifts** per staff member: one-off or weekly repeating, with dates and times. Trainers see their own schedule. Reception sees all trainers' schedules.
- The app knows who is **on duty right now** from the shifts. Reception uses this to pick a cover trainer.

### 6.4 Trainer assignment and cover
- Reception sets the member's **primary trainer**, after agreeing it with the member, and can change it later. This is only possible while the member has an active membership that includes a personal trainer. If that runs out, the trainer link is paused (plans and history are kept) and resumes on renewal.
- Members **without** a trainer can still log free workouts by picking exercises from the library, so they get progress charts too.
- **Cover**: when a member checks in and their trainer isn't on shift, reception can assign an on-duty trainer **for that day only**. The cover trainer gets **read-only** access to the member's current plan and log until the end of that day (gym time zone). They cannot edit or create plans. The member can still log their workout as usual, with the cover trainer helping.
- All assignments and covers are recorded in the change history.

### 6.5 Workout plans
- A plan is either:
  - **PDF**: the trainer uploads a file and the member downloads or views it, or
  - **Interactive**: Plan → Days (e.g. "Day A – Upper body") → Exercises with target sets, reps (or "max"), weight, rest and notes.
- **Exercise library**: a gym-wide list, seeded with a default set of common exercises (Greek and English names, muscle group). Trainers can add exercises. Every plan uses library exercises so progress charts match across plans.
- **Templates**: a trainer saves a plan as a template, then assigns and adjusts copies for individual members.
- A member has **one active plan** at a time. Old plans are kept in history.

### 6.6 Workout logging and progress
- The member opens today's day of the plan and logs each set (reps + weight), marks exercises done, and adds notes. Works comfortably one-handed on a phone.
- **Charts**:
  - Weight per exercise over time (top set and estimated one-rep max).
  - Weekly training volume.
  - Attendance (visits per week).
  - Body measurements.
- The trainer sees the same charts for their clients.

### 6.7 Body measurements
- The trainer records measurements: body weight, body fat %, optional circumferences. Members can see them in their charts.
- Optional **progress photos**, visible only to the member and their trainer. These require the member's explicit consent (§8).

### 6.8 Group classes
- The owner defines class types (spinning, pilates…) and a schedule: repeating weekly or one-off, with trainer, room, time and **capacity**.
- Members whose active memberships include classes (or who have class-pack entries left) book a spot and can cancel up to a cut-off (gym setting, default 2 h before). A late cancellation or no-show uses up a class-pack entry.
- The trainer and reception see the attendee list. Attendance is taken by check-in or ticked by the trainer.

### 6.9 Owner dashboard
- Income per month, by membership type and payment method.
- Active members, new members, and members who didn't renew (per month).
- Busiest hours (heatmap from check-ins).
- Expiring this week, today's visitors, who's in now.

### 6.10 Change history
- An append-only log of important actions: who recorded each payment, membership changes and freezes, trainer assignments and covers, plan changes, staff and shift changes, deletions. Visible to the owner. Entries can't be edited.

### 6.11 Notifications
- Channels: **email** (always) and **web push** (if the member installed the app and allowed it).
- Events: membership expiring and expired, visit pack low, class booking reminder, new plan assigned.

## 7. Architecture

```
            ┌─────────────── one React web app (PWA) ───────────────┐
            │ Member · Trainer · Reception · Owner · Kiosk screens  │
            └──────────────────────┬────────────────────────────────┘
                                   │ HTTPS (REST + WebSocket for live check-ins)
                         ┌─────────▼─────────┐
                         │   NestJS API      │── scheduled jobs (reminders)
                         │ auth · gyms · ... │── email (SMTP) · web push
                         └─────────┬─────────┘
                ┌──────────────────┼──────────────────┐
         PostgreSQL (RLS)    File storage (S3-compatible:     
                              PDFs, photos)
```

**Stack**
- **Repo**: one monorepo (pnpm workspaces): `apps/web`, `apps/api`, `packages/shared` (shared types and validation schemas).
- **Web**: React + Vite + TypeScript, React Router, TanStack Query, Tailwind + shadcn/ui, i18next (el/en), Recharts, a browser QR scanner library, installable PWA with a service worker.
- **API**: NestJS + TypeScript. Role and permission guards. WebSocket gateway for live reception updates. `@nestjs/schedule` for daily jobs. `web-push` (VAPID) and Nodemailer.
- **Database**: PostgreSQL with **Drizzle ORM** and migrations.
- **Local dev**: Docker Compose with Postgres, MinIO (S3-compatible file storage) and Mailpit (catches emails locally).
- **Tests**: unit and integration tests on the API, especially permissions and gym isolation. End-to-end tests (Playwright) for the main flows: sell membership → check in → log workout.

**Multi-gym isolation**
- Every gym-owned table has a `gym_id`.
- **PostgreSQL Row-Level Security** policies filter every query by the current gym. The API sets the current gym (and user) per request, inside the request's transaction. A bug in a query can't leak another gym's rows.
- People are global accounts. A `gym_roles` table links person ↔ gym ↔ role(s).
- v1: Dimitris (platform admin) creates gyms and their owner accounts. Later: self-service gym registration.

**Accounts and sign-in**
- Email + password. Short-lived access token plus a refresh token in a secure httpOnly cookie. Password reset by email.
- Members sign up themselves with a one-time code from reception (§6.0). Staff are invited by email.
- The Kiosk tablet signs in as a restricted *device* account that can only run check-ins.

## 8. Privacy and GDPR
- Body measurements and progress photos are health-related data. They are only stored with the member's **explicit consent**, given in the app, and can be withdrawn.
- Members can **download their data** and request **deletion**. Payment records are kept as required for accounting, separated from the person on deletion where legally allowed.
- Least-privilege access by role (§5). Photos and PDFs are served only through signed, expiring links.
- Before going live, a short privacy notice is shown at registration. The legal text is the gym owner's responsibility.

## 9. Delivery phases (about six months)

| Phase | Content |
|---|---|
| 0 | **Spike**: confirm PWA install + push on a real iPhone in Greece and on Android. Set up repo, Docker and CI. |
| 1 | Foundation: gyms, accounts, roles, Row-Level Security, i18n, app shell per role. |
| 2 | Memberships (types, packs, passes, freeze), payments, check-in (kiosk + live reception), who's in, renewals list, change history. |
| 3 | Staff, shifts, on-duty view, trainer assignment, cover access. |
| 4 | Exercise library, plans (PDF + interactive), templates, logging, charts, measurements. |
| 5 | Notifications (email + push), owner dashboard, occupancy indicator. |
| 6 | Group classes and booking. |
| 7 | GDPR features, polish, **pilot** with the owner, staff and test members. Then decide on deployment. |

Each phase ends with something the gym owner can try.

## 10. Left to the builder
- The exact QR scanning library, UI component details and chart styling.
- Database column-level details and indexes.
- The default seed list of exercises.

## 11. Open questions
- None blocking. The gym's actual pricing (which membership types include a trainer or classes) is the owner's business decision and is configured in the app, not built into it.

## 12. Calls made by Claude (please check)
- A separate **Reception** role and a **Kiosk device** account.
- **Auto check-out** after a set time (default 2 h) in place of a manual check-out.
- **Rotating QR code** (about 30 s), so screenshots can't be reused.
- Early renewals start when the current membership ends. Freeze pushes the end date forward.
- Reminders **5 days** before expiry (configurable) by email and push.
- Cover access ends at midnight in the gym's time zone. Cover trainers can't edit, but members can still log.
- ~~Reception registers members~~ → replaced 2026-11-16 by Dimitris's decision: members self-sign-up with a reception code (§6.0).
- **Drizzle ORM**, **NestJS scheduled jobs** (no Redis in v1), **MinIO** for files locally.
- One active plan per member at a time.
- Members can hold several memberships at once (e.g. gym + class pack). Trainer link pauses when personal training lapses. Members without a trainer can log free workouts.
- A late class cancellation or no-show uses up a class-pack entry.
- Class cancellation cut-off of 2 h (configurable). No waitlist in v1.
