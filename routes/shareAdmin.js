const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const shareAdminController = require('../controllers/shareAdminController');
const { authenticateToken, isAdmin, isShareAdmin } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'gagan_banking_secret_key_123';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'gagan_refresh_key_456';

// This route is for users to fetch a stock's price from the main app
router.get('/stocks/price/:symbol', authenticateToken, shareAdminController.getStockPriceBySymbol);

// All routes below are for share admins only and require share admin authentication
router.use(authenticateToken, isShareAdmin);

router.get('/stats', shareAdminController.getShareStats);
router.get('/stocks', shareAdminController.getAllStocks);
router.post('/stocks', shareAdminController.addStock);
router.put('/stocks/:id', shareAdminController.updateStockPrice);

// Route to add a new share offering (IPO/FPO)
router.post('/offerings', shareAdminController.addShareOffering);

// Routes for share allotment process
router.get('/offerings/allotment-ready', shareAdminController.getOfferingsWithApplicants);
router.get('/offerings/:id/applicants', shareAdminController.getApplicantsForOffering);
router.post('/process-allotment', shareAdminController.processAllotment);



module.exports = router;