const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const ssoController = require('../controllers/ssoController');
const { verifyToken, hasRole } = require('../middleware/authMiddleware');

// GET /api/auth/sso/login - redirect to PEA SSO
router.get('/sso/login', ssoController.ssoLogin);

// GET /api/auth/sso/callback - PEA SSO redirects back here with ?code=...
router.get('/sso/callback', ssoController.ssoCallback);

// GET /api/auth/sso/logout - full page navigation, ends the PEA SSO session too
router.get('/sso/logout', ssoController.ssoLogout);

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/register (Note: You may want to protect this in production)
router.post('/register', authController.register);

// POST /api/auth/logout
router.post('/logout', authController.logout);

// GET /api/auth/users (Super Admin only)
router.get('/users', verifyToken, hasRole(['super_admin']), authController.getUsers);

// PUT /api/auth/users/:id (Super Admin only)
router.put('/users/:id', verifyToken, hasRole(['super_admin']), authController.updateUser);

// DELETE /api/auth/users/:id (Super Admin only)
router.delete('/users/:id', verifyToken, hasRole(['super_admin']), authController.deleteUser);

module.exports = router;
