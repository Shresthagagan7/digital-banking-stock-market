const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'gagan_banking_secret_key_123';
let socketServer;

function getAuthToken(request) {
    const cookies = request.headers.cookie || '';
    const authCookie = cookies.split(';').map(cookie => cookie.trim()).find(cookie => cookie.startsWith('authToken='));
    return authCookie ? decodeURIComponent(authCookie.slice('authToken='.length)) : null;
}

function initializeMarketSocket(server) {
    socketServer = new WebSocketServer({ server, path: '/ws/market' });
    socketServer.on('connection', (socket, request) => {
        const token = getAuthToken(request);
        try {
            if (!token) throw new Error('Missing authentication token');
            socket.user = jwt.verify(token, JWT_SECRET);
            socket.send(JSON.stringify({ type: 'market:connected', message: 'Live market updates enabled.' }));
        } catch (error) {
            socket.close(1008, 'Authentication required');
            return;
        }

        socket.on('error', error => console.error('Market WebSocket error:', error.message));
    });
    console.log('Market WebSocket running on ws://localhost:' + (process.env.PORT || 3000) + '/ws/market');
}

function broadcastMarketUpdate(stock) {
    if (!socketServer) return;
    const message = JSON.stringify({ type: 'market:price-updated', stock });
    socketServer.clients.forEach(socket => {
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
    });
}

module.exports = { initializeMarketSocket, broadcastMarketUpdate };
