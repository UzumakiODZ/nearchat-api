const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const {Expo} = require("expo-server-sdk");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const redis = require("redis");
const multer = require('multer');
const { S3Client } = require("@aws-sdk/client-s3");
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const app = express();
const prisma = new PrismaClient();
const expo  = new Expo();
const server = http.createServer(app);
const auth = require("./middleware/auth");
const io = new Server(server, {
    cors: {
        origin: "*",
    },
});

const storage = multer.memoryStorage();
const upload = multer({ dest: 'uploads/' });

require("dotenv").config();

app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379"
});

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
    },
});




//generate JWT token
function generateToken(user) {
    return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "30m" });
}

//generate refresh token
function generateRefreshToken(user) {

    const refreshToken = jwt.sign({id: user.id }, JWT_SECRET, { expiresIn: "7d" });
    
    return refreshToken;
}

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

            const sender = await prisma.user.findUnique({
                where: { id: senderId }
            });

            if (!sender) {
                console.log("Sender not found");
                return;
            }
            
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
    const { username, email, password, age, latitude, longitude } = req.body;

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
                age,
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
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const accessToken = generateToken(user);
        const refreshToken = generateRefreshToken(user);

        // Remove password from response
        const { password: _, ...userWithoutPassword } = user;

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "None",
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({ 
            user: userWithoutPassword, 
            accessToken,
            userId: user.id 
        });

    } catch (error) {
        console.error("Login error details:", error);
        res.status(500).json({ error: "Login failed", details: error.message });
    }
});

app.post('/refresh',(req, res) => {
    if (req.cookies?.jwt) {

        // Destructuring refreshToken from cookie
        const refreshToken = req.cookies.jwt;

        // Verifying refresh token
        jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET,
            (err, decoded) => {
                if (err) {

                    // Wrong Refesh Token
                    return res.status(406).json({ message: 'Unauthorized' });
                }
                else {
                    // Correct token we send a new access token
                    const accessToken = jwt.sign({
                        username: userCredentials.username,
                        email: userCredentials.email
                    }, process.env.ACCESS_TOKEN_SECRET, {
                        expiresIn: '10m'
                    });
                    return res.json({ accessToken });
                }
            })
    } else {
        return res.status(406).json({ message: 'Unauthorized' });
    }
});

//post friend request
app.post("/send-friend-request", auth, async (req, res) => {
  const { userId, receiverId } = req.body;
  try {
    await prisma.request.create({
      data: {
        senderId: userId,
        receiverId: receiverId,
      },
    });

    return res.status(201).json({ message: "Friend request sent" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/accept-friend-request", auth, async (req, res) => {
  const { requestId, senderId, receiverId } = req.body;

  try {
    // Create the friendship
    await prisma.friend.create({
      data: {
        userAId: senderId,  // was userId which is undefined
        userBId: receiverId,
      },
    });

    // Delete the request status to accepted
    await prisma.request.delete({
      where: { id: requestId },
    });

    return res.status(201).json({ message: "Friend request accepted" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

// Create message
app.post("/messages", auth, async (req, res) => {
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

// Get nearby users
app.get("/nearby-users", auth, async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Authentication required" });
    }

    const userId = parseInt(req.body.userId, 10);
    const radiusKm = parseFloat(req.body.distance);
    const sexuality = req.body.sexualtiy;
    const gender = req.body.gender;

    try {

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
            AND sexuality = ${sexuality}
            AND gender = ${gender}
            ORDER BY distance;
        `;

        res.json(nearbyUsers);
    } catch (error) {
        console.error('Error in nearby-users endpoint:', error);
        res.status(500).json({ 
            error: "Server error",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

//Get connestions list
app.get("/users/connections", auth, async (req, res) => {
    const userId = parseInt(req.body.userId, 10);
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Authentication required" });
    }

    try{
        const friendships = await prisma.friend.findMany({
            where: {
                OR: [
                { userAId: userId },
                { userBId: userId },
                ],
            },
            include: {
                userA: true,
                userB: true,
            },
        });

        const friends = friendships.map((friendship) =>
        friendship.userAId === userId
            ? friendship.userB
            : friendship.userA
        );

        console.log(friends);
    }catch (error){
        console.log(error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
});

//Get requests list
app.get("/users/requests", auth, async(req,res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const userId = parseInt(req.body.userId, 10);

    if (!token) {
        return res.status(401).json({ error: "Authentication required" });
    }

    try{
        const data = await prisma.request.findMany({
            where: {
                receiverId: userId
            }
        });

        return data;

    }catch(error){
        console.log(error);
        res.status(500).json({ error: "Failed to fetch requests" });
    }
})

// Get messages between two users
app.get("/messages", auth, async (req, res) => {
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

//Add user video
app.put("/users/video", auth, upload.single('video'), async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Authentication required" });
    }

    try {
        const videoBuffer = req.file.buffer;
        const { userId } = req.body;

        const { Readable } = require('stream');
        const inputStream = new Readable();
        inputStream.push(videoBuffer);
        inputStream.end();

        const passthrough = new PassThrough();

        const s3Params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: `videos/${userId}-${Date.now()}.mp4`,
            Body: passthrough,
            ContentType: 'video/mp4',
        };

        const ffmpegCommand = ffmpeg(inputStream)
            .inputFormat(req.file.mimetype.split('/')[1])
            .outputOptions([
                '-c:v libx264',
                '-preset medium',
                '-crf 23',
                '-vf scale=1280:-1',
                '-c:a aac',
                '-b:a 128k',
                '-f mp4'
            ])
            .output(passthrough)
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Video compression failed' });
                }
            });

        ffmpegCommand.run();
        const data = await s3.upload(s3Params).promise();

        const s3Url = data.Location;

        const user = await prisma.user.update({
            where: { id: parseInt(userId) },
            data: { videoUrl: s3Url },
        });

        res.json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user location
app.put("/users/location", auth, async (req, res) => {

    try {
        const { id } = req.body;
        const { longitude, latitude } = req.body;

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

app.put("/update-video", auth, async(req,res) => {

    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Authentication required" });
    }

    try{
        const {userId,videoUrl} = req.body();
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const user = await prisma.user.update({
            where: { userId: parseInt(userId) },
            data: { videoUrl},
        });
        res.json(user);
    } catch (error){
        res.status(500).json({
            error: "Failed to update location",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
})

//update user description
app.put("/update-description", auth, async(req,res) => {

    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Authentication required" });
    }

    try{
        const {userId,description} = req.body();
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: "Authentication required" });
        }
        const user = await prisma.user.update({
            where: { userId: Number.parseInt(userId) },
            data: { description},
        });
        res.json(user);
    } catch (error){
        res.status(500).json({
            error: "Failed to update location",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
})

// Update Expo push token
app.put("/update-push-token", async (req, res) => {
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

// Delete user
app.delete("/users", auth, async (req, res) => {
    const { id } = req.body;
    try {
        await prisma.user.delete({ where: { id: parseInt(id) } });
        res.status(204).send();
    } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({ error: "Unable to delete user" });
    }
});

module.exports = app;

