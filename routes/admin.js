const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const adminController = require('../controllers/adminController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'gagan_banking_secret_key_123';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'gagan_refresh_key_456';

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