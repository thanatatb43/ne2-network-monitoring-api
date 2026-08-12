const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DeviceMetrics, NetworkDevices, OfficeEquipmentLoan, OfficeEquipment, Sequelize } = require('../models');
const { Op } = require('sequelize');

/**
 * Utility to clean HTML tags from Teams messages
 */
const cleanText = (text) => {
  if (!text) return '';
  // Remove Teams mention tags and their inner content (e.g., <at>Network Status Bot</at>)
  let cleaned = text.replace(/<at>.*?<\/at>/gi, '');
  // Remove remaining HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  // Replace common HTML entities
  cleaned = cleaned.replace(/&nbsp;/gi, ' ');
  return cleaned.trim().toLowerCase();
};

/**
 * Shared device search by name/province, used by both "check" and "ip" commands
 */
const findDevicesByTerm = (searchTerm) => {
  return NetworkDevices.findAll({
    where: {
      [Op.or]: [
        { pea_name: { [Op.substring]: searchTerm } },
        { province: { [Op.substring]: searchTerm } }
      ]
    },
    include: [{ model: DeviceMetrics, as: 'metrics' }],
    limit: 10 // Prevent wall of text
  });
};

const formatCheckResult = (searchTerm, devices) => {
  if (devices.length === 0) {
    return `❌ ไม่พบข้อมูลสำหรับ: **"${searchTerm}"**`;
  }

  if (devices.length === 1) {
    const d = devices[0];
    const m = d.metrics;
    const statusEmoji = m?.status === 'up' ? '✅' : '❌';
    const statusText = m?.status === 'up' ? 'ปกติ (ONLINE)' : 'ขัดข้อง (OFFLINE)';

    return `${statusEmoji} **สถานะอุปกรณ์: ${d.pea_name}**\n\n` +
      `• จังหวัด: ${d.province}\n` +
      `• เกตเวย์: ${d.gateway}\n` +
      `• สถานะ: **${statusText}**\n` +
      `• อัปเดตล่าสุด: ${m ? new Date(m.checked_at).toLocaleString('th-TH') : 'ไม่พบข้อมูล'}`;
  }

  let listText = `🔍 พบอุปกรณ์ที่เกี่ยวข้องกับ **"${searchTerm}"** จำนวน ${devices.length} รายการ:\n\n`;
  devices.forEach(d => {
    const m = d.metrics;
    const statusEmoji = m?.status === 'up' ? '✅' : '❌';
    listText += `${statusEmoji} **${d.pea_name}**: ${m?.status === 'up' ? 'ปกติ' : 'ขัดข้อง'}\n`;
  });

  if (devices.length === 10) {
    listText += `\n*แสดงผลสูงสุด 10 รายการ*`;
  }
  return listText;
};

const formatIpResult = (searchTerm, devices) => {
  if (devices.length === 0) {
    return `❌ ไม่พบข้อมูลสำหรับ: **"${searchTerm}"**`;
  }

  let listText = `🌐 **ข้อมูล IP ที่เกี่ยวข้องกับ "${searchTerm}"** (${devices.length} รายการ)\n\n`;
  devices.forEach(d => {
    listText += `📍 **${d.pea_name}** (${d.province || '-'})\n` +
      `  • Gateway: ${d.gateway || '-'}\n` +
      `  • Sub IP Gateway 1: ${d.sub_ip1_gateway || '-'}\n` +
      `  • Sub IP Gateway 2: ${d.sub_ip2_gateway || '-'}\n` +
      `  • WAN Gateway (MPLS): ${d.wan_gateway_mpls || '-'}\n` +
      `  • WAN IP (FortiGate): ${d.wan_ip_fgt || '-'}\n\n`;
  });

  if (devices.length === 10) {
    listText += `*แสดงผลสูงสุด 10 รายการ*`;
  }
  return listText;
};

/**
 * status / สถานะ - global up/down summary
 */
const handleStatus = async () => {
  const stats = await DeviceMetrics.findAll({
    attributes: [
      'status',
      [Sequelize.fn('COUNT', Sequelize.col('DeviceMetrics.device_id')), 'count']
    ],
    include: [{
      model: NetworkDevices,
      as: 'device',
      attributes: [],
      required: true // INNER JOIN to only include devices that are NOT soft-deleted
    }],
    group: ['status'],
    raw: true
  });

  let total = 0;
  let online = 0;
  let offline = 0;

  stats.forEach(s => {
    const count = parseInt(s.count);
    total += count;
    if (s.status === 'up') online = count;
    else offline += count;
  });

  const emoji = offline > 0 ? '⚠️' : '✅';

  return `${emoji} **สรุปสถานะเครือข่ายล่าสุด**\n\n` +
    `• อุปกรณ์ทั้งหมด: **${total}**\n` +
    `• ปกติ (Online): **${online}**\n` +
    `• ขัดข้อง (Offline): **${offline}**\n\n` +
    `ตรวจสอบรายละเอียดเพิ่มเติมได้ที่ Dashboard ครับ`;
};

/**
 * check / เช็ค / ตรวจสอบ [ชื่อ/จังหวัด] - search device status by name or province
 */
const handleCheck = async (searchTerm) => {
  if (!searchTerm) {
    return 'กรุณาระบุชื่ออุปกรณ์หรือจังหวัดที่ต้องการตรวจสอบ เช่น **"check อุบล"** หรือ **"เช็ค อุบล"**';
  }
  const devices = await findDevicesByTerm(searchTerm);
  return formatCheckResult(searchTerm, devices);
};

/**
 * ip / ไอพี [ชื่อ/จังหวัด] - search device IP details by name or province
 */
const handleIp = async (searchTerm) => {
  if (!searchTerm) {
    return 'กรุณาระบุชื่ออุปกรณ์หรือจังหวัดที่ต้องการตรวจสอบ IP เช่น **"ip อุบล"** หรือ **"ไอพี อุบล"**';
  }
  const devices = await findDevicesByTerm(searchTerm);
  return formatIpResult(searchTerm, devices);
};

/**
 * devices / อุปกรณ์ - list all devices grouped by province
 */
const handleDevices = async () => {
  const allDevices = await NetworkDevices.findAll({
    attributes: ['pea_name', 'province'],
    order: [
      ['province', 'ASC'],
      ['pea_name', 'ASC']
    ],
    raw: true
  });

  if (allDevices.length === 0) {
    return '❌ ไม่พบข้อมูลอุปกรณ์ในระบบ';
  }

  const grouped = allDevices.reduce((acc, d) => {
    const prov = d.province || 'ไม่ระบุจังหวัด';
    if (!acc[prov]) acc[prov] = [];
    acc[prov].push(d.pea_name);
    return acc;
  }, {});

  let listText = `🏢 **รายชื่ออุปกรณ์แยกตามสาขา (${allDevices.length} อุปกรณ์)**\n\n`;

  for (const [province, names] of Object.entries(grouped)) {
    listText += `📍 **${province}**\n`;
    names.forEach(name => {
      listText += `  - ${name}\n`;
    });
    listText += `\n`;
  }

  listText += `ใช้คำสั่ง **"check [ชื่ออุปกรณ์]"** หรือ **"เช็ค [ชื่ออุปกรณ์]"** เพื่อดูสถานะแต่ละตัวครับ`;
  return listText;
};

/**
 * loans / ยืม / รายการยืม - list all office equipment currently borrowed (not yet returned)
 */
const handleLoans = async () => {
  const openLoans = await OfficeEquipmentLoan.findAll({
    where: { returned_at: null },
    include: [{ model: OfficeEquipment, as: 'equipment', attributes: ['name'] }],
    order: [['borrowed_at', 'ASC']]
  });

  if (openLoans.length === 0) {
    return '✅ ไม่มีอุปกรณ์ที่ถูกยืมอยู่ในขณะนี้';
  }

  const now = new Date();
  let listText = `📋 **รายการอุปกรณ์ที่กำลังถูกยืม (${openLoans.length} รายการ)**\n\n`;

  openLoans.forEach(loan => {
    const equipName = loan.equipment ? loan.equipment.name : `#${loan.equipment_id}`;
    const isOverdue = loan.due_date && new Date(loan.due_date) < now;
    const dueStr = loan.due_date
      ? new Date(loan.due_date).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
      : 'ไม่ระบุ';

    listText += `${isOverdue ? '⚠️' : '📦'} **${equipName}**\n` +
      `  • ผู้ยืม: ${loan.borrower_name || 'ไม่ระบุ'} (${loan.borrower_emp_id || '-'})\n` +
      `  • กำหนดคืน: ${dueStr}${isOverdue ? ' *(เกินกำหนด)*' : ''}\n\n`;
  });

  return listText;
};

/**
 * help / ช่วยเหลือ / วิธีใช้ - command reference
 */
const handleHelp = async () => {
  return `🤖 **คู่มือการใช้งาน Network Monitoring Bot**\n\n` +
    `คุณสามารถสั่งงานผมได้ด้วยคำสั่งดังนี้ครับ (ใช้ภาษาไทยหรืออังกฤษก็ได้):\n\n` +
    `• **status** / **สถานะ** : ดูสรุปภาพรวมสถานะอุปกรณ์ทั้งหมดในระบบ\n` +
    `• **devices** / **อุปกรณ์** : ดูรายชื่ออุปกรณ์/จังหวัด/สาขาที่มีในระบบ\n` +
    `• **check** / **เช็ค** / **ตรวจสอบ [ชื่ออุปกรณ์]** : ตรวจสอบสถานะของอุปกรณ์นั้นๆ เช่น *check ตึก 1 ชั้น 2* หรือ *เช็ค ตึก 1 ชั้น 2*\n` +
    `• **check** / **เช็ค [ชื่อจังหวัด]** : ตรวจสอบสถานะอุปกรณ์ทั้งหมดในจังหวัดนั้น เช่น *check อุบล* หรือ *ตรวจสอบ อุบล*\n` +
    `• **ip** / **ไอพี [ชื่ออุปกรณ์/จังหวัด]** : ตรวจสอบ Gateway, Sub IP, WAN IP ของสถานที่นั้นๆ เช่น *ip อุบล* หรือ *ไอพี อุบล*\n` +
    `• **loans** / **ยืม** / **รายการยืม** : ดูรายการอุปกรณ์สำนักงานที่กำลังถูกยืมอยู่ (ยังไม่คืน)\n` +
    `• **help** / **ช่วยเหลือ** / **วิธีใช้** : แสดงรายการคำสั่งที่ใช้งานได้ทั้งหมด\n\n` +
    `พิมพ์ชื่อผมแล้วตามด้วยคำสั่งได้เลยครับ!`;
};

const DEFAULT_RESPONSE = 'สวัสดีครับ! ผมคือ Network Monitoring Bot. ลองพิมพ์คำว่า **"status"** หรือ **"สถานะ"** เพื่อดูสรุปสถานะอุปกรณ์ทั้งหมดครับ';

// Order doesn't matter for correctness anymore: each entry only matches when its keyword
// is at the very START of the message, so "check status ..." can no longer be hijacked
// by the "status" handler the way it could when matching used .includes() anywhere in the text.
const COMMANDS = [
  { keywords: ['status', 'สถานะ'], handler: handleStatus },
  { keywords: ['check', 'เช็ค', 'ตรวจสอบ'], handler: handleCheck },
  { keywords: ['ip', 'ไอพี'], handler: handleIp },
  { keywords: ['devices', 'อุปกรณ์'], handler: handleDevices },
  { keywords: ['loans', 'ยืม', 'รายการยืม'], handler: handleLoans },
  { keywords: ['help', 'ช่วยเหลือ', 'วิธีใช้'], handler: handleHelp }
];

/**
 * Match the command against known keywords (Thai or English) and dispatch to its handler.
 * The keyword must be a prefix of the message; anything after it (space optional) is
 * passed to the handler as its argument.
 */
const dispatchCommand = async (command) => {
  for (const { keywords, handler } of COMMANDS) {
    const matchedKeyword = keywords.find(kw => command === kw || command.startsWith(kw));
    if (matchedKeyword) {
      const arg = command.slice(matchedKeyword.length).trim();
      return handler(arg);
    }
  }
  return DEFAULT_RESPONSE;
};

/**
 * Handle incoming requests from Microsoft Teams Outgoing Webhook
 */
const handleTeamsOutgoingWebhook = async (req, res, next) => {
  try {
    const teamsToken = process.env.TEAMS_OUTGOING_WEBHOOK_TOKEN;

    // Log diagnostic information to webhook_debug.log
    try {
      const logData = {
        timestamp: new Date().toISOString(),
        headers: req.headers,
        body: req.body,
        rawBodyLength: req.rawBody ? req.rawBody.length : null,
        rawBodyString: req.rawBody ? req.rawBody.toString('utf8') : null,
        teamsTokenConfigured: !!teamsToken,
        teamsTokenLength: teamsToken ? teamsToken.trim().length : 0,
      };

      if (teamsToken) {
        const authHeader = req.headers.authorization;
        const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
        const expectedHmac = crypto
          .createHmac('sha256', Buffer.from(teamsToken.trim(), 'base64'))
          .update(rawBody)
          .digest('base64');
        const receivedHmac = authHeader ? authHeader.replace('HMAC ', '').trim() : null;

        logData.expectedHmac = expectedHmac;
        logData.receivedHmac = receivedHmac;
        logData.hmacMatch = expectedHmac === receivedHmac;
      }

      fs.appendFileSync(
        path.join(__dirname, '../../webhook_debug.log'),
        JSON.stringify(logData, null, 2) + '\n---\n'
      );
    } catch (logErr) {
      console.error('Failed to write to webhook_debug.log:', logErr.message);
    }

    // Optional: HMAC Verification if token is provided
    if (teamsToken) {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ message: 'No authorization header' });
      }

      // Use the raw body buffer for accurate signature validation, falling back to stringified body if absent
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
      const expectedHmac = crypto
        .createHmac('sha256', Buffer.from(teamsToken.trim(), 'base64'))
        .update(rawBody)
        .digest('base64');

      const receivedHmac = authHeader.replace('HMAC ', '').trim();

      if (expectedHmac !== receivedHmac) {
        console.warn(`[Webhook] HMAC Verification Failed. Expected: "${expectedHmac}", Received: "${receivedHmac}"`);
        return res.status(401).json({ message: 'Invalid HMAC signature' });
      }
    }

    const rawText = req.body.text;
    const command = cleanText(rawText);
    console.log(`[Webhook] Processing command: "${command}"`);

    const responseText = await dispatchCommand(command);

    res.status(200).json({
      type: 'message',
      text: responseText
    });
  } catch (error) {
    console.error('[Webhook] Error handling Teams request:', error);
    next(error);
  }
};

module.exports = {
  handleTeamsOutgoingWebhook
};
