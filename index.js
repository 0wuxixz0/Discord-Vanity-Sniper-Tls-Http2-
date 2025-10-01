const tls = require("tls");
const WebSocket = require('ws');
const http2 = require('http2');
const fs = require('fs');

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

const guilds = new Map();
const claimerToken = 'token abicim';
const listToken = 'token';
const guildId = "swid;
const MFA_PATH = "mfa_token.json";

let mfaToken = null;
let lastMfaToken = null;
let lastSequence = null;

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64;:133.0) Gecko/20100101 Firefox/133.0',
    'Authorization': claimerToken,
    'Content-Type': 'application/json',
    'X-Super-Properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRmlyZWZveCIsImRldmljZSI6IiIsInN5c3RlbV9sb2NhbGUiOiJ0ci1UUiIsImJyb3dzZXJfdXNlcl9hZ2VudCI6Ik1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQ7IHJ2OjEzMy4wKSBHZWNrby8yMDEwMDEwMSBGaXJlZm94LzEzMy4wIiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTMzLjAiLCJvc192ZXJzaW9uIjoiMTAiLCJyZWZlcnJlciI6Imh0dHBzOi8vd3d3Lmdvb2dsZS5jb20vIiwicmVmZXJyaW5nX2RvbWFpbiI6Ind3dy5nb29nbGUuY29tIiwic2VhcmNoX2VuZ2luZSI6Imdvb2dsZSIsInJlZmVycmVyX2N1cnJlbnQiOiIiLCJyZWZlcnJpbmdfZG9tYWluX2N1cnJlbnQiOiIiLCJyZWxlYXNlX2NoYW5uZWwiOiJjYW5hcnkiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjozNTYxNDAsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGwsImhhc19jbGllbnRfbW9kcyI6ZmFsc2V9'
};

const sessions = new Map();
const MAX_SESSIONS = 2;

function createSession(index) {
    const session = http2.connect("https://discord.com", {
        settings: { enablePush: false, initialWindowSize: 1073741824 }
    });

    session.on('error', () => {
        sessions.delete(index);
        setTimeout(() => createSession(index), 100);
    });

    session.on('close', () => {
        sessions.delete(index);
        setTimeout(() => createSession(index), 100);
    });

    sessions.set(index, session);
    return session;
}

for (let i = 0; i < MAX_SESSIONS; i++) {
    createSession(i);
}

let sessionIndex = 0;
async function fastHttp2Request(method, path, customHeaders = {}, body = null) {
    return new Promise((resolve, reject) => {
        let session = sessions.get(sessionIndex);
        sessionIndex = (sessionIndex + 1) % MAX_SESSIONS;

        if (!session || session.destroyed) {
            session = createSession(sessionIndex);
        }

        const requestHeaders = {
            ...BASE_HEADERS,
            ...customHeaders,
            ":method": method,
            ":path": path,
            ":authority": "discord.com",
            ":scheme": "https"
        };

        const stream = session.request(requestHeaders, { endStream: !body });
        const chunks = [];

        stream.on("data", chunk => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
        stream.on("error", reject);

        if (body) stream.end(Buffer.from(body));
    });
}

function loadMfaToken() {
    try {
        if (!fs.existsSync(MFA_PATH)) return false;
        const data = fs.readFileSync(MFA_PATH, 'utf8').trim();
        if (!data) return false;
        
        const parsed = JSON.parse(data);
        if (parsed.token && parsed.token !== lastMfaToken) {
            const payload = JSON.parse(Buffer.from(parsed.token.split('.')[1], 'base64'));
            const now = Math.floor(Date.now() / 1000);
            
            if (now < payload.nbf || now > payload.exp) return false;
            
            lastMfaToken = mfaToken = parsed.token;
            return true;
        }
    } catch (e) {}
    return false;
}

const sockets = new Set();
const MAX_SOCKETS = 2;

function createWebSocket() {
    const socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

    socket.on('open', () => {
        socket.send(JSON.stringify({
            op: 2,
            d: {
                token: listToken,
                intents: 1,
                properties: { $os: "linux", $browser: "firefox", $device: "kenzxharper" }
            }
        }));
    });

    socket.on('message', async (rawData) => {
        try {
            const payload = JSON.parse(rawData);
            if (payload.s) lastSequence = payload.s;

            if (payload.op === 10) {
                setInterval(() => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ op: 1, d: lastSequence }));
                    }
                }, payload.d.heartbeat_interval);
                return;
            }

            if (payload.op === 0 && payload.t === "GUILD_UPDATE") {
                const find = guilds.get(payload.d.guild_id);
                if (find && find !== payload.d.vanity_url_code) {
                    console.log(find);
                    const promises = [];
                    const headers = { "X-Discord-MFA-Authorization": mfaToken };

                    for (let i = 0; i < 2; i++) {
                        promises.push(fastHttp2Request(
                            "PATCH",
                            `/api/v10/guilds/${guildId}/vanity-url`,
                            headers,
                            JSON.stringify({ code: find })
                        ));
                    }

                    Promise.race(promises).catch(() => {});
                }
            } else if (payload.op === 0 && payload.t === "READY") {
                guilds.clear();
                for (const guild of payload.d.guilds) {
                    if (guild.vanity_url_code) {
                        guilds.set(guild.id, guild.vanity_url_code);
                    }
                }
            }
        } catch (_) {}
    });

    socket.on('close', () => {
        sockets.delete(socket);
        if (sockets.size < MAX_SOCKETS) {
            setTimeout(() => {
                const newSocket = createWebSocket();
                sockets.add(newSocket);
            }, 1000);
        }
    });

    return socket;
}

loadMfaToken();

for (let i = 0; i < MAX_SOCKETS; i++) {
    const socket = createWebSocket();
    if (socket) sockets.add(socket);
}

setInterval(loadMfaToken, 3000);
setInterval(async () => {
    try { await fastHttp2Request("HEAD", "/"); } catch (_) {}
}, 15000);
