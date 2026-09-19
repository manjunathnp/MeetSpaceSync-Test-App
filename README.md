<div align="center">
  <img src="public/assets/meetspacesync-logo-dark.png" alt="MeetSpaceSync" width="420" />

  # MeetSpaceSync

  **A self-contained meeting-room booking demo built for reliable UI and API automation practice.**

  [![Version](https://img.shields.io/badge/version-1.0.0-168eea?style=flat-square)](https://github.com/manjunathnp/MeetSpaceSync-Test-App/releases/tag/v1.0.0)
  [![Node.js](https://img.shields.io/badge/Node.js-18%2B-34a853?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Zero dependencies](https://img.shields.io/badge/runtime_dependencies-0-24d6a0?style=flat-square)](package.json)
</div>

## About

MeetSpaceSync is an automation-friendly demo application that models a realistic meeting-room booking workflow. It combines a responsive single-page web interface, a documented REST API, role-based access, validation-heavy business rules, stable test hooks, and resettable seed data in one lightweight Node.js project.

The project is intended for QA engineers, SDETs, developers, and learners who need a predictable system for practising browser automation, API testing, contract testing, and end-to-end scenarios.

## Demo site

MeetSpaceSync is a self-contained demo site. No database or third-party service is required: start the server locally and use the same process for the UI, interactive API reference, and REST endpoints.

| Experience | Address |
| --- | --- |
| Web application | [http://127.0.0.1:4300/](http://127.0.0.1:4300/) |
| Interactive API docs | [http://127.0.0.1:4300/docs](http://127.0.0.1:4300/docs) |
| OpenAPI specification | [http://127.0.0.1:4300/openapi.json](http://127.0.0.1:4300/openapi.json) |
| API base URL | `http://127.0.0.1:4300/api` |

The demo data can be restored at any time from **Settings → Reset demo data** or with `POST /api/reset` while signed in as an administrator.

> This repository does not currently advertise a hosted public instance. The local demo contains the complete product experience and API surface.

## Features

- Three buildings, 25 floors, and 125 uniquely named meeting rooms
- Administrator and standard-user roles with JWT-based authentication
- Room discovery, capacity details, amenities, availability, and activation status
- Booking creation, editing, cancellation, filtering, sorting, and pagination
- Live conflict detection before booking submission
- Append-only audit trails with required reasons for sensitive changes
- Consistent validation and error envelopes across the UI and API
- Interactive API documentation generated from the bundled OpenAPI contract
- API key and Basic authentication practice endpoints
- Resettable deterministic data for repeatable automation runs
- Responsive UI, accessible dialogs, keyboard support, and stable `data-testid` hooks
- Built-in playground for forms, keyboard input, file upload/download, tables, frames, drag-and-drop, and sliders

## Technology

- Node.js 18 or newer
- Native Node.js HTTP server
- HTML5, CSS3, and vanilla JavaScript
- JSON file persistence for local demo state
- OpenAPI 3.0.3
- No runtime dependencies and no build step

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer
- Git

### Run locally

```bash
git clone https://github.com/manjunathnp/MeetSpaceSync-Test-App.git
cd MeetSpaceSync-Test-App
npm start
```

Open [http://127.0.0.1:4300/](http://127.0.0.1:4300/) in a browser. Stop the server with `Ctrl+C`.

No `npm install` step is required because the application has no external runtime packages.

### Optional configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Network interface used by the server |
| `PORT` | `4300` | HTTP port |
| `DATA_FILE` | `./data.json` | Writable JSON data file |
| `JWT_SECRET` | Demo-only fallback | Secret used to sign local JWTs |

Example:

```bash
HOST=0.0.0.0 PORT=8080 JWT_SECRET=replace-this-value npm start
```

## Demo accounts

| Account | Credentials | Access |
| --- | --- | --- |
| Administrator | `admin` / `admin123` | Full booking, room-administration, and reset access |
| Standard user | `user` / `user123` | Browse rooms and manage their own bookings |
| API key | `X-API-Key: meetspacesync-key-2026` | API-key practice endpoint |
| Basic auth | `meetspace` / `basic123` | Basic-auth practice endpoint |

These credentials are intentionally public and are only for the demo environment. Do not reuse them in a production system.

## API quick start

Check service health:

```bash
curl http://127.0.0.1:4300/api/ping
```

Sign in and obtain a bearer token:

```bash
curl -X POST http://127.0.0.1:4300/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

For endpoint schemas, example bodies, authorization controls, and live requests, open the [interactive API docs](http://127.0.0.1:4300/docs).

## Testing

```bash
npm run smoke              # Fast health and sanity checks
npm test                   # API regression and deep QA suites
npm run deep               # Deep QA suite only
python3 tests/ui-suite.py  # Browser suite; requires Playwright and Chromium
```

The automated coverage includes authentication, validation, authorization, booking conflicts, audit history, room status changes, search, sorting, pagination, responsive layout, dialogs, navigation, the playground, and API documentation.

## Project structure

```text
.
├── public/
│   ├── assets/             # Brand logo and transparent app icon
│   ├── index.html          # Web application shell
│   ├── app.js              # Single-page application logic
│   ├── styles.css          # Responsive application styles
│   ├── docs.html           # Interactive API reference
│   └── openapi.json        # OpenAPI 3.0.3 contract
├── tests/                  # API, deep QA, smoke, and browser suites
├── server.js               # HTTP server, API routes, and persistence
├── package.json            # Project metadata and commands
└── README.md
```

## Automation support

Interactive elements expose stable `data-testid` attributes, including navigation, authentication, booking fields, availability feedback, dialogs, tables, pagination, settings, the playground, and API documentation controls. The `POST /api/reset` endpoint restores the original 125-room seed so suites can start from a known state.

## Production note

MeetSpaceSync is deliberately designed as a test and learning application. Its public demo credentials, JSON-file storage, and fallback signing secret are convenient for local automation but are not production security patterns. A production deployment should use durable database storage, secret management, HTTPS, hardened authentication, rate limiting, and appropriate operational monitoring.

## Version

This repository is published as **MeetSpaceSync v1.0.0**. See the [v1.0.0 release](https://github.com/manjunathnp/MeetSpaceSync-Test-App/releases/tag/v1.0.0) for the tagged source.

---

Conceptualised and developed by **Manjunath N P**<br>
[linkedin.com/in/manjunathnp](https://www.linkedin.com/in/manjunathnp/)
