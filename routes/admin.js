const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const adminController = require('../controllers/adminController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'gagan_banking_secret_key_123';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'gagan_refresh_key_456';

// Admin Login - This route does not need authentication
router.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const [result] = await db.promise().query("SELECT id, first_name, last_name, phone_number, password, role FROM users WHERE phone_number = ? AND role = 'admin'", [phone]);
        
        if (result.length === 0) {
            return res.status(404).json({ message: "Admin account not found" });
        }

        const isMatch = await bcrypt.compare(password, result[0].password);
        if (isMatch) {
            const admin = result[0];
            const token = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '1h' });
            
            res.cookie('authToken', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 60 * 60 * 1000 // 1 hour
            });
            
            const refreshToken = jwt.sign({ id: admin.id, role: admin.role }, REFRESH_SECRET, { expiresIn: '7d' });
            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                path: '/api/refresh-token',
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            delete admin.password;
            res.json({ message: "Admin login successful", user: admin });
        } else {
            res.status(401).json({ message: "Incorrect admin credentials" });
        }
    } catch (err) {
        console.error("Admin Login Server Error:", err.message);
        return res.status(500).json({ message: "DB Error: " + err.message });
    }
});

// All routes below this will be protected by authenticateToken and isAdmin middlewares
router.use(authenticateToken, isAdmin);

router.get('/stats', adminController.getStats);
router.get('/all-users', adminController.getAllUsers);
router.get('/pending-requests', adminController.getPendingRequests);

// Routes for admin actions
router.post('/approve-user', adminController.approveUser);
router.post('/update-status', adminController.updateStatus);
router.post('/update-balance', adminController.updateBalance);
router.post('/send-message', adminController.sendDirectMessage); // Assuming you have this function
router.delete('/delete-user/:id', adminController.deleteUser);

module.exports = router;