const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const {Expo} = require("expo-server-sdk");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();
const prisma = new PrismaClient();
const expo  = new Expo();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
    },
});

app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// Function to send push notification
async function sendReplyNotification(senderName, receiverId, messageText, chatId) {
    try {
        // 1. Get Receiver's Token
        const receiver = await prisma.user.findUnique({
            where: { id: parseInt(receiverId) },
            select: { expoPushToken: true }
        });

        if (!receiver?.expoPushToken) return;

        // 2. Construct Notification
        const messages = [{
            to: receiver.expoPushToken,
            sound: 'default',
            title: `New message from ${senderName}`,
            body: messageText,
            
            // CRITICAL: This enables the text box in the notification
            categoryId: 'chat-reply', 
            
            // CRITICAL: This data is sent back to you when they reply
            data: { 
                chatId: chatId, 
                senderId: receiverId // needed for context
            },
        }];

        // 3. Send
        await expo.sendPushNotificationsAsync(messages);
        console.log("Notification sent to", receiverId);
    } catch (error) {
        console.error("Error sending notification:", error);
    }
}

// WebSocket handling
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Join room for real-time updates
    socket.on("join", ({ userId }) => {
        socket.join(userId.toString());
        console.log(`User ${userId} joined room ${userId}`);
    });

    socket.on("authenticate", async ({ token }) => {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            socket.userId = decoded.id;
            console.log(`User ${decoded.id} authenticated`);
        } catch (error) {
            console.log("Authentication failed");
            console.log(error);
            socket.disconnect();
        }
    });

    socket.on("sendMessage", async ({ token, receiverId, content }) => {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const senderId = decoded.id;

            const message = await prisma.message.create({
                data: { senderId, receiverId, content },
            });

            // Emit to both sender and receiver rooms for real-time chat
            io.to(senderId.toString()).emit("receiveMessage", message);
            io.to(receiverId.toString()).emit("receiveMessage", message);

            //send notification
            sendReplyNotification(sender.username, receiverId, content, senderId);

        } catch (error) {
            console.log("Message send failed:", error);
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

// User registration
app.post("/register", async (req, res) => {
    const { username, email, password, latitude, longitude } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: "All fields are required!" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const user = await prisma.user.create({
            data: {
                username,
                email,
                password: hashedPassword,
                latitude,
                longitude,
            },
        });

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });

        res.status(201).json({ user, token });
    } catch (error) {
        console.error("Error registering user:", error);
        res.status(500).json({ error: "Registration failed" });
    }
});

// Update the login endpoint
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        // Add logging to debug
        console.log('Login attempt for email:', email);

        const user = await prisma.user.findUnique({ 
            where: { email },
            select: {
                id: true,
                email: true,
                password: true,
                username: true
            }
        });

        if (!user) {
            console.log('User not found');
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Debug password comparison
        console.log('Comparing passwords...');
        const isPasswordValid = await bcrypt.compare(password, user.password);
        console.log('Password valid:', isPasswordValid);

        if (!isPasswordValid) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });

        // Remove password from response
        const { password: _, ...userWithoutPassword } = user;

        res.json({ 
            user: userWithoutPassword, 
            token,
            userId: user.id 
        });

    } catch (error) {
        console.error("Login error details:", error);
        res.status(500).json({ error: "Login failed", details: error.message });
    }
});

app.get("/users", async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { 
                id: true,
                password: true,
                username: true,
                email: true,
                latitude: true,
                longitude: true,
                createdAt: true
            }
        });

        if (!users) {
            return res.status(404).json({ error: "No users found" });
        }

        res.json(users);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// Get nearby users
app.get("/nearby-users/:userId", async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const radiusKm = parseFloat(req.query.radiusKm) || 10;

    try {
        // Log the request parameters
        console.log(`Fetching nearby users for userId: ${userId}, radius: ${radiusKm}km`);

        const user = await prisma.user.findUnique({ 
            where: { id: userId },
            select: { id: true, latitude: true, longitude: true }
        });

        if (!user) {
            console.error(`User not found: ${userId}`);
            return res.status(404).json({ error: "User not found" });
        }

        if (!user.latitude || !user.longitude) {
            console.error(`Location missing for user: ${userId}`);
            return res.status(400).json({ error: "User location not set" });
        }

        const { latitude, longitude } = user;

        // Log the coordinates being used
        console.log(`User coordinates - Lat: ${latitude}, Long: ${longitude}`);

        const nearbyUsers = await prisma.$queryRaw`
            SELECT 
                id, 
                username, 
                latitude, 
                longitude,
                (6371 * acos(
                    cos(radians(${latitude})) *
                    cos(radians(latitude)) *
                    cos(radians(longitude) - radians(${longitude})) +
                    sin(radians(${latitude})) *
                    sin(radians(latitude))
                )) AS distance
            FROM "User"
            WHERE id != ${userId} 
            AND latitude IS NOT NULL 
            AND longitude IS NOT NULL
            AND (6371 * acos(
                cos(radians(${latitude})) *
                cos(radians(latitude)) *
                cos(radians(longitude) - radians(${longitude})) +
                sin(radians(${latitude})) *
                sin(radians(latitude))
            )) < ${radiusKm}
            ORDER BY distance;
        `;

        // Log the number of users found
        console.log(`Found ${nearbyUsers.length} nearby users`);

        res.json(nearbyUsers);
    } catch (error) {
        console.error('Error in nearby-users endpoint:', error);
        res.status(500).json({ 
            error: "Server error",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Update user location
app.put("/users/:id/location", async (req, res) => {
    const { id } = req.params;
    const { longitude, latitude } = req.body;

    try {
        const user = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { longitude, latitude },
        });
        res.json(user);
    } catch (error) {
        console.error("Error updating user location:", error);
        res.status(500).json({ error: "Unable to update location" });
    }
});

// Delete user
app.delete("/users/:id", async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.user.delete({ where: { id: parseInt(id) } });
        res.status(204).send();
    } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({ error: "Unable to delete user" });
    }
});

app.post("/check-user", async (req, res) => {
    try {
        const { email } = req.body;
        
        const user = await prisma.user.findUnique({
            where: { email },
            select: { id: true }
        });

        res.json({ exists: !!user });
    } catch (error) {
        console.error("Error checking user:", error);
        res.status(500).json({ error: "Failed to check user" });
    }
});

app.post("/update-location", async (req, res) => {
    try {
        const { userId, latitude, longitude } = req.body;
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: "Authentication required" });
        }

        // Update user location without updatedAt
        const user = await prisma.user.update({
            where: {
                id: parseInt(userId)
            },
            data: {
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude)
            },
            select: {
                id: true,
                username: true,
                latitude: true,
                longitude: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json({ success: true, user });

    } catch (error) {
        console.error("Error updating location:", error);
        res.status(500).json({ 
            error: "Failed to update location",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.post("/messages", async (req, res) => {
    try {
        const { content, senderId, receiverId } = req.body;
        
        if (!content || !senderId || !receiverId) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const newMessage = await prisma.message.create({
            data: {
                content,
                sender: { connect: { id: parseInt(senderId) } },
                receiver: { connect: { id: parseInt(receiverId) } },
                createdAt: new Date()
            },
            include: {
                sender: true,
                receiver: true
            }
        });

        io.to(senderId.toString()).emit("receiveMessage", newMessage);
        io.to(receiverId.toString()).emit("receiveMessage", newMessage);

        sendReplyNotification(newMessage.sender.username, receiverId, content, senderId);

        res.json(newMessage);
    } catch (error) {
        console.error("Error creating message:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
});

app.get("/messages", async (req, res) => {
    try {
        const { senderId, receiverId } = req.query;
        
        if (!senderId || !receiverId) {
            return res.status(400).json({ error: "Missing required parameters" });
        }

        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    {
                        AND: [
                            { senderId: parseInt(senderId.toString()) },
                            { receiverId: parseInt(receiverId.toString()) }
                        ]
                    },
                    {
                        AND: [
                            { senderId: parseInt(receiverId.toString()) },
                            { receiverId: parseInt(senderId.toString()) }
                        ]
                    }
                ]
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        res.json(messages);
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
});

app.post("/update-push-token", async (req, res) => {
    const { userId, token } = req.body;
    
    if (!Expo.isExpoPushToken(token)) {
        return res.status(400).json({ error: "Invalid Expo push token" });
    }

    try {
        await prisma.user.update({
            where: { id: parseInt(userId) },
            data: { expoPushToken: token },
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Error updating push token:", error);
        res.status(500).json({ error: "Failed to update token" });
    }
});

// Start server
const port = process.env.PORT || 4000;
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
