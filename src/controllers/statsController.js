const { UserActivity, sequelize } = require('../models');
const { Op } = require('sequelize');
const jwt = require('jsonwebtoken');

/**
 * Handle tracking frontend events
 */
const trackEvent = async (req, res, next) => {
  try {
    const { event, session_token, path, timestamp } = req.body;

    if (!event) {
      return res.status(400).json({
        success: false,
        message: 'Event type is required'
      });
    }

    // Try to extract user_id from body or token
    let user_id = req.body.user_id || null;
    
    if (!user_id) {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        try {
          const token = authHeader.split(' ')[1];
          const decoded = jwt.decode(token);
          if (decoded && decoded.id) {
            user_id = decoded.id;
          }
        } catch (e) {
          // Silently fail if token is invalid
        }
      }
    }

    const activity = await UserActivity.create({
      event,
      session_token,
      path,
      user_id,
      ip_address: (req.headers['x-forwarded-for'] || req.socket.remoteAddress).replace('::ffff:', ''),
      userAgent: req.headers['user-agent'],
      timestamp: timestamp || new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Event tracked successfully',
      data: { id: activity.id }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Get summary statistics for the dashboard
 */
const getSummary = async (req, res, next) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // 1. Online Users (Unique session_tokens in the last 5 minutes)
    const onlineUsers = await UserActivity.count({
      distinct: true,
      col: 'session_token',
      where: {
        timestamp: { [Op.gte]: fiveMinutesAgo }
      }
    });

    // 2. Views Today
    const viewsToday = await UserActivity.count({
      where: {
        event: 'visit',
        timestamp: { [Op.gte]: todayStart }
      }
    });

    // 3. Views Month
    const viewsMonth = await UserActivity.count({
      where: {
        event: 'visit',
        timestamp: { [Op.gte]: monthStart }
      }
    });

    // 4. Views Year
    const viewsYear = await UserActivity.count({
      where: {
        event: 'visit',
        timestamp: { [Op.gte]: yearStart }
      }
    });

    // 5. Total Views
    const totalViews = await UserActivity.count({
      where: {
        event: 'visit'
      }
    });

    res.status(200).json({
      success: true,
      data: {
        online_users: onlineUsers,
        views_today: viewsToday,
        views_month: viewsMonth,
        views_year: viewsYear,
        total_views: totalViews
      }
    });

  } catch (error) {
    next(error);
  }
};

module.exports = {
  trackEvent,
  getSummary
};
