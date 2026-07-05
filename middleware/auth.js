const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'gagan_banking_secret_key_123';

exports.authenticateToken = (req, res, next) => {
    const token = req.cookies.authToken;

    if (!token) return res.status(401).json({ message: "Access Denied: No token provided." });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: "Invalid Token" });
        req.user = user;
        next();
    });
};

exports.isAdmin = (req, res, next) => {
    const userRole = (req.user && req.user.role) ? req.user.role.toLowerCase() : '';
    if (req.user && userRole === 'admin') {
        next();
    } else {
        console.log(`Access Denied for user ID: ${req.user ? req.user.id : 'Unknown'}, Role: ${req.user ? req.user.role : 'None'}`);
        res.status(403).json({ message: "Access Denied: Admin privileges required" });
    }
};