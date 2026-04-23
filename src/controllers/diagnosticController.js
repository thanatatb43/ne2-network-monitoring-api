/**
 * Controller for network diagnostic tests (Speed, Latency)
 */

/**
 * Simple echo/ping test to measure round-trip latency
 */
const ping = (req, res) => {
  res.status(200).json({
    success: true,
    message: 'pong',
    server_time: Date.now()
  });
};

/**
 * Download test: returns dummy data to measure download speed
 */
const downloadTest = (req, res) => {
  const size = 100 * 1024 * 1024; // 100MB
  const buffer = Buffer.alloc(size, '0');
  
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': size,
    'Content-Disposition': 'attachment; filename="speedtest.bin"'
  });
  res.end(buffer);
};

/**
 * Upload test: receives data and returns stats to measure upload speed
 */
const uploadTest = (req, res) => {
  const startTime = Date.now();
  const size = req.headers['content-length'] ? parseInt(req.headers['content-length']) : 0;
  
  res.status(200).json({
    success: true,
    bytes_received: size,
    duration_ms: Date.now() - startTime
  });
};

const dns = require('dns').promises;
const { getNbtStatInfo } = require('../services/scannerService');
const { SpeedTestLog, User } = require('../models');

/**
 * Report results from a client-side speed test
 */
const reportResults = async (req, res, next) => {
  try {
    const { download_speed, upload_speed, latency, computer_name, mac_address, user_id } = req.body;
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress).replace('::ffff:', '');
    
    // Attempt to gather more info if not provided
    let finalComputerName = computer_name;
    let finalMacAddress = mac_address;

    if (!finalComputerName || !finalMacAddress) {
      if (process.platform === 'win32') {
        const nbtInfo = await getNbtStatInfo(ip);
        if (!finalComputerName) finalComputerName = nbtInfo.name;
        if (!finalMacAddress) finalMacAddress = nbtInfo.mac;
      }
    }

    const log = await SpeedTestLog.create({
      ip_address: ip,
      download_speed,
      upload_speed,
      latency,
      computer_name: finalComputerName || 'Unknown',
      mac_address: finalMacAddress || 'Unknown',
      user_id: req.user ? req.user.id : (user_id || null),
      userAgent: req.headers['user-agent']
    });

    res.status(201).json({
      success: true,
      message: 'Speed test results logged successfully',
      data: log
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get speed test history (Admin only)
 */
const getHistory = async (req, res, next) => {
  try {
    const logs = await SpeedTestLog.findAll({
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'username', 'first_name', 'last_name']
      }],
      order: [['timestamp', 'DESC']],
      limit: 100 // Limit to last 100 tests
    });

    res.status(200).json({
      success: true,
      data: logs
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get the client's information (IP, Hostname, MAC) as seen by the server
 */
const getMyIp = async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress).replace('::ffff:', '');
  
  let computerName = null;
  let macAddress = null;

  try {
    // 1. Try Reverse DNS for Hostname
    const names = await dns.reverse(ip);
    if (names && names.length > 0) computerName = names[0];
  } catch (e) {
    // DNS reverse failed, common for local IPs
  }

  // 2. Try nbtstat for Windows Client Name and MAC (Works if on same subnet)
  if (process.platform === 'win32') {
    const nbtInfo = await getNbtStatInfo(ip);
    if (nbtInfo.name) computerName = nbtInfo.name;
    if (nbtInfo.mac) macAddress = nbtInfo.mac;
  }

  res.status(200).json({
    success: true,
    ip: ip,
    computer_name: computerName || 'Unknown',
    mac_address: macAddress || 'Unknown (Not on same subnet)'
  });
};

module.exports = {
  ping,
  downloadTest,
  uploadTest,
  reportResults,
  getHistory,
  getMyIp
};
