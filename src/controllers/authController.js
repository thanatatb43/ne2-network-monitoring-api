const { User, TokenBlacklist } = require('../models');
const jwt = require('jsonwebtoken');

/**
 * Utility to validate password complexity
 */
const isPasswordComplex = (password) => {
  const minLength = 10;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  return password.length >= minLength && hasUpperCase && hasLowerCase && hasSpecialChar;
};

/**
 * Handle user registration
 */
const register = async (req, res, next) => {
  try {
    const { 
      username, password, confirm_password, 
      first_name, last_name, pea_branch, pea_division,
      role 
    } = req.body;

    // 1. Basic Validation
    if (!username || !password || !confirm_password || !first_name || !last_name || !pea_branch || !pea_division) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // 2. Complexity Validation
    if (!isPasswordComplex(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 10 characters long and include an uppercase letter, a lowercase letter, and a special character'
      });
    }

    if (password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    // 2. Check for existing user
    const userExists = await User.findOne({ where: { username } });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'Username is already taken'
      });
    }

    // 3. Validate Role if provided
    const validRoles = ['user', 'computer_admin', 'network_admin', 'super_admin', 'manager'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role provided'
      });
    }

    // 4. Create User
    const newUser = await User.create({
      username,
      password_hash: password, // Model hook will hash this automatically
      first_name,
      last_name,
      pea_branch,
      pea_division,
      role: role || 'user' // Default to 'user' role
    });

    res.status(201).json({
      success: true,
      data: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        first_name: newUser.first_name,
        last_name: newUser.last_name
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Handle user login
 */
const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username and password'
      });
    }

    // Find user
    const user = await User.findOne({ where: { username } });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT (24h expiry)
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        pea_branch: user.pea_branch,
        pea_division: user.pea_division
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Handle user logout (Blacklist token)
 */
const logout = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(400).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.decode(token);

    // Add token to blacklist until its natural expiry
    await TokenBlacklist.create({
      token,
      expiresAt: new Date(decoded.exp * 1000)
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all users (Super Admin only)
 */
const getUsers = async (req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'username', 'role', 'first_name', 'last_name', 'pea_branch', 'pea_division', 'createdAt']
    });

    res.status(200).json({
      success: true,
      data: users
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update user details (Super Admin only)
 */
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { username, password, first_name, last_name, pea_branch, pea_division, role } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Protection: super_admin accounts cannot be edited via API
    if (user.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'System Protection: Accounts with the super_admin role cannot be edited'
      });
    }

    // Prepare updates
    const updates = {};
    const validRoles = ['user', 'computer_admin', 'network_admin', 'super_admin', 'manager'];
    
    if (username && username.trim() !== '' && username !== user.username) {
        updates.username = username;
    }
    
    if (password && password.trim() !== '') {
      // 1. Complexity Validation
      if (!isPasswordComplex(password)) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 10 characters long and include an uppercase letter, a lowercase letter, and a special character'
        });
      }

      // 2. Check if new password is same as current password
      const isSamePassword = await user.comparePassword(password);
      if (isSamePassword) {
        return res.status(400).json({
          success: false,
          message: 'New password must be different from the current password'
        });
      }
      updates.password_hash = password;
    }

    if (first_name && first_name.trim() !== '' && first_name !== user.first_name) {
        updates.first_name = first_name;
    }
    if (last_name && last_name.trim() !== '' && last_name !== user.last_name) {
        updates.last_name = last_name;
    }
    if (pea_branch && pea_branch.trim() !== '' && pea_branch !== user.pea_branch) {
        updates.pea_branch = pea_branch;
    }
    if (pea_division && pea_division.trim() !== '' && pea_division !== user.pea_division) {
        updates.pea_division = pea_division;
    }
    
    if (role && role.trim() !== '' && role !== user.role) {
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role provided'
        });
      }
      updates.role = role;
    }

    // Check if there is anything to update
    if (Object.keys(updates).length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No changes detected. Everything is already up to date.'
      });
    }

    await user.update(updates);

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a user (Super Admin only)
 */
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Protection: super_admin accounts cannot be deleted
    if (user.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'System Protection: Accounts with the super_admin role cannot be deleted'
      });
    }

    await user.destroy();

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  logout,
  getUsers,
  register,
  updateUser,
  deleteUser
};
