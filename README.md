# backEndChat

A Node.js/Express backend server for a real-time, location-aware chat application. It supports user authentication, geo-based nearby user discovery, persistent messaging, real-time WebSocket communication via Socket.IO, and push notifications through the Expo push service.

---

## Features

- **User registration & authentication** — Register with location data; log in with JWT-based sessions (7-day expiry).
- **Real-time messaging** — Bidirectional, instant messaging over WebSocket (Socket.IO), delivered to both sender and receiver rooms.
- **REST messaging API** — HTTP endpoints to send and retrieve conversation history.
- **Nearby user discovery** — Find other users within a configurable radius (km) using the Haversine formula executed directly in PostgreSQL.
- **Location management** — Store and update each user's latitude/longitude coordinates.
- **Expo push notifications** — Sends a push notification to a recipient's device whenever a new message is received.
- **Password security** — Passwords are hashed with bcrypt before storage.
- **CORS enabled** — All origins are allowed; easily tightened for production.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express 4 |
| Real-time | Socket.IO 4 |
| Database | PostgreSQL (via Prisma ORM 6) |
| Auth | JSON Web Tokens (`jsonwebtoken`) |
| Passwords | bcrypt |
| Push Notifications | Expo Server SDK |
| Config | dotenv |
| Dev server | nodemon |

---

## Data Models

### User

| Field | Type | Notes |
|---|---|---|
| `id` | Int | Auto-increment primary key |
| `username` | String | Unique, max 255 chars |
| `email` | String | Unique, max 255 chars |
| `password` | String | bcrypt hash, max 255 chars |
| `latitude` | Float? | Optional GPS coordinate |
| `longitude` | Float? | Optional GPS coordinate |
| `expoPushToken` | String? | Expo device push token |
| `createdAt` | DateTime | Auto-set on creation |

### Message

| Field | Type | Notes |
|---|---|---|
| `id` | Int | Auto-increment primary key |
| `content` | String | Message body |
| `senderId` | Int | Foreign key → User |
| `receiverId` | Int | Foreign key → User |
| `createdAt` | DateTime | Auto-set on creation |

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/register` | Register a new user |
| `POST` | `/login` | Log in and receive a JWT |
| `POST` | `/check-user` | Check if an email is already registered |

#### `POST /register`
**Body:** `{ username, email, password, latitude?, longitude? }`  
**Response:** `{ user, token }`

#### `POST /login`
**Body:** `{ email, password }`  
**Response:** `{ user, token, userId }`

#### `POST /check-user`
**Body:** `{ email }`  
**Response:** `{ exists: true | false }`

---

### Users

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/users` | List all users |
| `GET` | `/nearby-users/:userId` | Get users within a radius |
| `PUT` | `/users/:id/location` | Update location (by param) |
| `POST` | `/update-location` | Update location (by body, requires `Authorization` header) |
| `DELETE` | `/users/:id` | Delete a user |
| `POST` | `/update-push-token` | Register an Expo push token |

#### `GET /nearby-users/:userId`
**Query params:** `radiusKm` (default: `10`)  
**Response:** Array of nearby users sorted by distance, each including `id`, `username`, `latitude`, `longitude`, `distance` (km).

#### `PUT /users/:id/location`
**Body:** `{ latitude, longitude }`

#### `POST /update-location`
**Headers:** `Authorization: Bearer <token>`  
**Body:** `{ userId, latitude, longitude }`

#### `POST /update-push-token`
**Body:** `{ userId, token }` — `token` must be a valid Expo push token.

---

### Messages

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/messages` | Send a message (also emits via WebSocket) |
| `GET` | `/messages` | Retrieve conversation history |

#### `POST /messages`
**Body:** `{ content, senderId, receiverId }`  
**Response:** Created message object (includes sender and receiver).

#### `GET /messages`
**Query params:** `senderId`, `receiverId`  
**Response:** Array of messages ordered by `createdAt` ascending.

---

## WebSocket Events (Socket.IO)

Connect to the server's root with Socket.IO. All events use the default namespace.

| Event (client → server) | Payload | Description |
|---|---|---|
| `join` | `{ userId }` | Join a personal room to receive messages |
| `authenticate` | `{ token }` | Verify JWT; disconnects on failure |
| `sendMessage` | `{ token, receiverId, content }` | Send a message in real-time |

| Event (server → client) | Payload | Description |
|---|---|---|
| `receiveMessage` | Message object | Emitted to sender and receiver rooms |

---

## Environment Variables

Create a `.env` file in the project root (never commit this file):

```env
# PostgreSQL connection string (used by Prisma for queries)
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"

# Direct connection URL (used by Prisma for migrations)
DIRECT_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"

# Secret key for signing JWTs
JWT_SECRET="your-strong-secret-here"

# Port the server listens on (default: 4000)
PORT=4000
```

---

## Getting Started

### Prerequisites

- **Node.js** v18 or later
- **npm** v9 or later
- A running **PostgreSQL** instance

### Installation

```bash
git clone https://github.com/UzumakiODZ/backEndChat.git
cd backEndChat
npm install
```

### Database Setup

1. Fill in `DATABASE_URL` and `DIRECT_URL` in your `.env` file.
2. Apply all Prisma migrations:

```bash
npx prisma migrate deploy
```

3. (Optional) Open Prisma Studio to inspect the database:

```bash
npx prisma studio
```

### Running the Server

**Production:**
```bash
npm start
```

**Development (with auto-reload via nodemon):**
```bash
npm run dev
```

The server starts on `http://localhost:4000` by default (configurable via `PORT`).

---

## Project Structure

```
backEndChat/
├── prisma/
│   ├── schema.prisma          # Prisma data models (User, Message)
│   └── migrations/            # Database migration history
├── server.js                  # Express app, Socket.IO server, all routes
├── package.json
├── app.json                   # Expo Android package config
└── .env                       # Environment variables (not committed)
```

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

ISC
