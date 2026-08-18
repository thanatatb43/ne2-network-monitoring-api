const https = require('https');
const { URL } = require('url');
const { DeviceDowntime, DeviceMetrics, OfficeEquipmentLoan, OfficeEquipment } = require('../models');

/**
 * Raw POST of a MessageCard to TEAMS_WEBHOOK_URL. Shared by device up/down
 * notifications and the daily overdue-equipment-loan digest.
 */
const postToTeamsWebhook = (messageCard, logLabel) => {
  const rawWebhookUrl = process.env.TEAMS_WEBHOOK_URL;

  if (!rawWebhookUrl) {
    console.log('[NotificationService] TEAMS_WEBHOOK_URL not configured. Skipping notification.');
    return Promise.resolve(false);
  }

  const webhookUrl = rawWebhookUrl.trim();

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
            console.log(`[NotificationService] Notification accepted (Status ${res.statusCode})${logLabel ? ' for ' + logLabel : ''}`);
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

/**
 * Helper to log downtime events to the database
 */
const logDowntime = async (device, status) => {
  try {
    const now = new Date();
    if (status === 'down') {
      // Guard against creating a duplicate: if this device already has an open
      // (unclosed) down record, it's still the same ongoing incident - don't
      // start a second one (this was the root cause of permanently orphaned
      // rows when two status-check paths raced each other, e.g. the background
      // ping loop and an on-demand /api/latency/check/:id call).
      const existingOpen = await DeviceDowntime.findOne({
        where: { device_id: device.id, status: 'down', up_at: null }
      });
      if (existingOpen) {
        return;
      }

      await DeviceDowntime.create({
        device_id: device.id,
        down_at: now,
        status: 'down'
      });
      console.log(`[Downtime] Logged DOWN event for ${device.pea_name}`);
    } else if (status === 'up') {
      // Close every open downtime record for this device, not just the latest -
      // self-heals if a duplicate ever slips through despite the guard above.
      const openRecords = await DeviceDowntime.findAll({
        where: { device_id: device.id, status: 'down', up_at: null },
        order: [['down_at', 'ASC']]
      });

      for (const record of openRecords) {
        const durationMs = now.getTime() - record.down_at.getTime();
        await record.update({
          up_at: now,
          duration_ms: durationMs,
          status: 'up'
        });
      }

      if (openRecords.length > 0) {
        console.log(`[Downtime] Logged UP event for ${device.pea_name}. Closed ${openRecords.length} open record(s).`);
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
  if (!process.env.TEAMS_WEBHOOK_URL) {
    console.log('[NotificationService] TEAMS_WEBHOOK_URL not configured. Skipping notification.');
    return;
  }

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

  return postToTeamsWebhook(messageCard, `${device.pea_name}: ${status}`);
};

/**
 * Daily digest of every OfficeEquipmentLoan that's past due_date and not yet
 * returned. Sends nothing if there's nothing overdue (no noise on a clean day).
 */
const notifyOverdueEquipmentLoans = async () => {
  try {
    const { Op } = require('sequelize');
    const now = new Date();

    const overdue = await OfficeEquipmentLoan.findAll({
      where: {
        due_date: { [Op.lt]: now },
        returned_at: null
      },
      include: [{ model: OfficeEquipment, as: 'equipment', attributes: ['name'] }],
      order: [['due_date', 'ASC']]
    });

    if (overdue.length === 0) {
      console.log('[EquipmentLoan] No overdue equipment loans today.');
      return;
    }

    const facts = overdue.map(loan => {
      const daysOverdue = Math.floor((now - new Date(loan.due_date)) / (1000 * 60 * 60 * 24));
      const equipName = loan.equipment ? loan.equipment.name : `#${loan.equipment_id}`;
      const dueStr = new Date(loan.due_date).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      return {
        "name": equipName,
        "value": `ผู้ยืม: ${loan.borrower_name || 'ไม่ระบุ'} (${loan.borrower_emp_id || '-'}) | กำหนดคืน: ${dueStr} | เกิน ${daysOverdue} วัน`
      };
    });

    const messageCard = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": "FFA500",
      "summary": `อุปกรณ์เกินกำหนดคืน ${overdue.length} รายการ`,
      "sections": [{
        "activityTitle": `⚠️ อุปกรณ์เกินกำหนดคืน (${overdue.length} รายการ)`,
        "facts": facts,
        "markdown": true
      }]
    };

    await postToTeamsWebhook(messageCard, `overdue equipment digest (${overdue.length} items)`);
  } catch (err) {
    console.error('[EquipmentLoan] Failed to send overdue digest:', err);
  }
};

/**
 * Immediate Teams notification fired the moment equipment is borrowed or returned
 * (scan action) - separate from and in addition to the daily overdue digest above.
 */
const notifyEquipmentLoanEvent = async (loan, equipment, eventType) => {
  try {
    const isBorrow = eventType === 'borrow';
    const color = isBorrow ? 'FFA500' : '00FF00';
    const emoji = isBorrow ? '📤' : '📥';
    const title = isBorrow ? 'มีการยืมอุปกรณ์' : 'มีการคืนอุปกรณ์';
    const equipName = equipment ? equipment.name : `#${loan.equipment_id}`;

    const facts = [
      { "name": "อุปกรณ์", "value": equipName },
      { "name": "ผู้ยืม", "value": `${loan.borrower_name || 'ไม่ระบุ'} (${loan.borrower_emp_id || '-'})` }
    ];

    if (loan.borrower_contact) {
      facts.push({ "name": "ติดต่อ", "value": loan.borrower_contact });
    }

    if (isBorrow) {
      facts.push({ "name": "วันที่ยืม", "value": new Date(loan.borrowed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) });
      if (loan.due_date) {
        facts.push({ "name": "กำหนดคืน", "value": new Date(loan.due_date).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) });
      }
    } else {
      facts.push({ "name": "วันที่คืน", "value": new Date(loan.returned_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) });
    }

    const messageCard = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": color,
      "summary": `${title}: ${equipName}`,
      "sections": [{
        "activityTitle": `${emoji} ${title}: **${equipName}**`,
        "facts": facts,
        "markdown": true
      }]
    };

    await postToTeamsWebhook(messageCard, `${eventType} equipment #${loan.equipment_id}`);
  } catch (err) {
    console.error('[EquipmentLoan] Failed to send loan event notification:', err);
  }
};

/**
 * Same as notifyEquipmentLoanEvent, but for a whole borrow-batch at once (borrowing
 * several equipment items in one action) - one consolidated Teams message listing
 * every item, instead of spamming one message per item.
 */
const notifyEquipmentLoanBatchEvent = async (loans, equipmentList, eventType) => {
  try {
    if (!loans || loans.length === 0) return;

    const isBorrow = eventType === 'borrow';
    const color = isBorrow ? 'FFA500' : '00FF00';
    const emoji = isBorrow ? '📤' : '📥';
    const title = isBorrow ? 'มีการยืมอุปกรณ์ (หลายรายการ)' : 'มีการคืนอุปกรณ์ (หลายรายการ)';
    const firstLoan = loans[0];

    const equipmentNameById = Object.fromEntries((equipmentList || []).map(e => [e.id, e.name]));
    const itemNames = loans.map(l => equipmentNameById[l.equipment_id] || `#${l.equipment_id}`).join(', ');

    const facts = [
      { "name": `อุปกรณ์ (${loans.length} รายการ)`, "value": itemNames },
      { "name": "ผู้ยืม", "value": `${firstLoan.borrower_name || 'ไม่ระบุ'} (${firstLoan.borrower_emp_id || '-'})` }
    ];

    if (firstLoan.borrower_contact) {
      facts.push({ "name": "ติดต่อ", "value": firstLoan.borrower_contact });
    }

    if (isBorrow) {
      facts.push({ "name": "วันที่ยืม", "value": new Date(firstLoan.borrowed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) });
      if (firstLoan.due_date) {
        facts.push({ "name": "กำหนดคืน", "value": new Date(firstLoan.due_date).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) });
      }
    } else {
      facts.push({ "name": "วันที่คืน", "value": new Date(firstLoan.returned_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) });
    }

    const messageCard = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "themeColor": color,
      "summary": `${title}: ${loans.length} รายการ`,
      "sections": [{
        "activityTitle": `${emoji} ${title}`,
        "facts": facts,
        "markdown": true
      }]
    };

    await postToTeamsWebhook(messageCard, `${eventType} batch of ${loans.length} equipment`);
  } catch (err) {
    console.error('[EquipmentLoan] Failed to send batch loan event notification:', err);
  }
};

/**
 * Self-healing check, meant to run once on server startup: closes any DeviceDowntime
 * record left open (up_at: null) whose device's latest DeviceMetrics already shows
 * it's back up. This can happen if the process was killed/restarted mid-flight while
 * the fire-and-forget notification/close for a recovery was still in progress.
 */
const reconcileOrphanedDowntime = async () => {
  try {
    const openRecords = await DeviceDowntime.findAll({
      where: { status: 'down', up_at: null }
    });

    if (openRecords.length === 0) return;

    let closedCount = 0;
    for (const record of openRecords) {
      const metric = await DeviceMetrics.findOne({ where: { device_id: record.device_id } });
      if (metric && metric.status === 'up' && metric.checked_at > record.down_at) {
        const upAt = metric.checked_at;
        const durationMs = Math.max(0, upAt.getTime() - record.down_at.getTime());
        await record.update({ up_at: upAt, duration_ms: durationMs, status: 'up' });
        closedCount++;
      }
    }

    if (closedCount > 0) {
      console.log(`[Downtime] Startup reconciliation: closed ${closedCount}/${openRecords.length} stale open record(s).`);
    }
  } catch (err) {
    console.error('[Downtime] Startup reconciliation failed:', err);
  }
};

module.exports = {
  sendTeamsNotification,
  reconcileOrphanedDowntime,
  notifyOverdueEquipmentLoans,
  notifyEquipmentLoanEvent,
  notifyEquipmentLoanBatchEvent
};
