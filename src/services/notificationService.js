const https = require('https');
const { URL } = require('url');

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
  const messageCard = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    "themeColor": color,
    "summary": `แจ้งเตือนอุปกรณ์ ${device.pea_name}: ${thaiStatus}`,
    "sections": [{
      "activityTitle": `${emoji} แจ้งเตือนสถานะอุปกรณ์: **${device.pea_name}**`,
      "activitySubtitle": `เกตเวย์: ${device.gateway}`,
      "facts": [
        { "name": "ชื่ออุปกรณ์", "value": device.pea_name },
        { "name": "สถานะปัจจุบัน", "value": `**${thaiStatus}**` },
        { "name": "สถานะก่อนหน้า", "value": prevThaiStatus },
        { "name": "จังหวัด", "value": device.province || 'ไม่ระบุ' },
        { "name": "เวลาที่ตรวจสอบ", "value": new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) }
      ],
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
