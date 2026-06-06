const request = require("supertest");

const mockPrisma = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  message: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

jest.mock("redis", () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock("socket.io", () => ({
  Server: jest.fn(() => ({
    on: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
  })),
}));

jest.mock("expo-server-sdk", () => {
  class Expo {
    static isExpoPushToken(token) {
      return typeof token === "string" && token.startsWith("ExponentPushToken[");
    }

    sendPushNotificationsAsync() {
      return Promise.resolve([]);
    }
  }

  return { Expo };
});

const app = require("../app");

describe("app validation and auth guard", () => {
  test("POST /register returns 400 when required fields are missing", async () => {
    const response = await request(app).post("/register").send({ email: "u@example.com" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "All fields are required!" });
  });

  test("POST /messages returns 400 when required fields are missing", async () => {
    const response = await request(app).post("/messages").send({ content: "hello" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Missing required fields" });
  });

  test("POST /update-push-token returns 400 for invalid Expo token", async () => {
    const response = await request(app)
      .post("/update-push-token")
      .send({ userId: 1, token: "not-a-valid-token" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid Expo push token" });
  });

  test("POST /check-user returns 401 without bearer token", async () => {
    const response = await request(app).post("/check-user").send({ email: "u@example.com" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });
});
