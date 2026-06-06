const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");

describe("auth middleware", () => {
  test("returns 401 when Authorization header is missing", () => {
    const req = { headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when token is invalid", () => {
    const req = { headers: { authorization: "Bearer bad.token" } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    jest.spyOn(jwt, "verify").mockImplementation(() => {
      throw new jwt.JsonWebTokenError("invalid token");
    });

    auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid token" });
    expect(next).not.toHaveBeenCalled();
  });

  test("sets req.userId and calls next for a valid token", () => {
    const req = { headers: { authorization: "Bearer good.token" } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    jest.spyOn(jwt, "verify").mockReturnValue({ id: 42 });

    auth(req, res, next);

    expect(req.userId).toBe(42);
    expect(next).toHaveBeenCalledTimes(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
