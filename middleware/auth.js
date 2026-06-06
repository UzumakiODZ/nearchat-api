const jwt = require("jsonwebtoken");

function auth(req, res, next) {
    const authHeader = req.headers.authorization;
    const [scheme, token] = authHeader ? authHeader.split(" ") : [null, null];

    if (scheme !== "Bearer" || !token) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError || err instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ error: "Invalid token" });
        }

        return next(err);
    }
}

module.exports = auth;