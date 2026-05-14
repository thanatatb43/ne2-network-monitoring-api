const https = require('https');
const { URL } = require('url');
const { DeviceDowntime } = require('../models');

/**
 * Helper to log downtime events to the database
 */
const logDowntime = async (device, status) => {
  try {
    const now = new Date();
    if (status === 'down') {
      // Create a new downtime record when device goes down
      await DeviceDowntime.create({
        device_id: device.id,
        down_at: now,
        status: 'down'
      });
      console.log(`[Downtime] Logged DOWN event for ${device.pea_name}`);
    } else if (status === 'up') {
      // Find the latest open downtime record and close it
      const lastDowntime = await DeviceDowntime.findOne({
        where: {
          device_id: device.id,
          status: 'down',
          up_at: null
        },
        order: [['down_at', 'DESC']]
      });

      if (lastDowntime) {
        const durationMs = now.getTime() - lastDowntime.down_at.getTime();
        await lastDowntime.update({
          up_at: now,
          duration_ms: durationMs,
          status: 'up'
        });
        console.log(`[Downtime] Logged UP event for ${device.pea_name}. Duration: ${Math.round(durationMs/1000)}s`);
      }
    }
  } catch (err) {
    console.error('[Downtime] Error logging event:', err);
  }
};

/**
 * Service to handle notifications to Microsoft Teams via Webhook or Power Automate
 */
const sendTeamsNotification = async (device, status, previousStatus) => {
  const rawWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
  
  if (!rawWebhookUrl) {
    console.log('[NotificationService] TEAMS_WEBHOOK_URL not configured. Skipping notification.');
    return;
  }

  const webhookUrl = rawWebhookUrl.trim();

  // Only send notification if status has changed
  if (status === previousStatus) {
    return;
  }

  const isDown = status === 'down';
  const color = isDown ? 'FF0000' : '00FF00';
  const emoji = isDown ? '❌' : '✅';
  
  // Thai Translation Mapping
  const thaiStatus = isDown ? 'ขัดข้อง (OFFLINE)' : 'ปกติ (ONLINE)';
  const prevThaiStatus = previousStatus === 'down' ? 'ขัดข้อง (OFFLINE)' : (previousStatus === 'up' ? 'ปกติ (ONLINE)' : 'ไม่ทราบสถานะ');

  // Format as a MessageCard (Required by Teams Workflows)
  const facts = [
    { "name": "ชื่ออุปกรณ์", "value": device.pea_name },
    { "name": "สถานะปัจจุบัน", "value": `**${thaiStatus}**` },
    { "name": "สถานะก่อนหน้า", "value": prevThaiStatus },
    { "name": "จังหวัด", "value": device.province || 'ไม่ระบุ' },
    { "name": "เวลาที่ตรวจสอบ", "value": new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) }
  ];

  // 1. Log to database first as requested
  await logDowntime(device, status);

  // 2. If coming back UP, try to add duration to the notification
  if (!isDown) {
    const lastRecord = await DeviceDowntime.findOne({
      where: { device_id: device.id, status: 'up' },
      order: [['up_at', 'DESC']]
    });
    if (lastRecord && lastRecord.duration_ms) {
      const seconds = Math.floor(lastRecord.duration_ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      let durationStr = `${seconds % 60} วินาที`;
      if (minutes > 0) durationStr = `${minutes % 60} นาที ${durationStr}`;
      if (hours > 0) durationStr = `${hours} ชั่วโมง ${durationStr}`;
      
      facts.push({ "name": "ระยะเวลาที่ขัดข้อง", "value": durationStr });
    }
  }

  const messageCard = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    "themeColor": color,
    "summary": `แจ้งเตือนอุปกรณ์ ${device.pea_name}: ${thaiStatus}`,
    "sections": [{
      "activityTitle": `${emoji} แจ้งเตือนสถานะอุปกรณ์: **${device.pea_name}**`,
      "activitySubtitle": `เกตเวย์: ${device.gateway}`,
      "facts": facts,
      "markdown": true
    }]
  };

  return new Promise((resolve) => {
    try {
      const url = new URL(webhookUrl);
      const data = JSON.stringify(messageCard);

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 15000,
        rejectUnauthorized: false
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[NotificationService] Notification accepted (Status ${res.statusCode}) for ${device.pea_name}: ${status}`);
            resolve(true);
          } else {
            console.error(`[NotificationService] Teams API returned error ${res.statusCode}: ${body}`);
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        console.error(`[NotificationService] Request error:`, error.message);
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        console.error(`[NotificationService] Request timed out`);
        resolve(false);
      });

      req.write(data);
      req.end();
    } catch (error) {
      console.error(`[NotificationService] Internal error:`, error.message);
      resolve(false);
    }
  });
};

module.exports = {
  sendTeamsNotification
};
