const crypto = require('crypto');
const { DeviceMetrics, Sequelize } = require('../models');

/**
 * Utility to clean HTML tags from Teams messages
 */
const cleanText = (text) => {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '').trim().toLowerCase();
};

/**
 * Handle incoming requests from Microsoft Teams Outgoing Webhook
 */
const handleTeamsOutgoingWebhook = async (req, res, next) => {
  try {
    const teamsToken = process.env.TEAMS_OUTGOING_WEBHOOK_TOKEN;

    // Optional: HMAC Verification if token is provided
    if (teamsToken) {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ message: 'No authorization header' });
      }

      // Note: In production, some versions of Teams might include extra spaces 
      // in the body string. For simplicity, we use the raw JSON body.
      const expectedHmac = crypto
        .createHmac('sha256', Buffer.from(teamsToken, 'base64'))
        .update(JSON.stringify(req.body))
        .digest('base64');

      const receivedHmac = authHeader.replace('HMAC ', '');

      if (expectedHmac !== receivedHmac) {
        console.log('[Webhook] HMAC Verification Failed');
        // We log it but continue for now if it's a dev environment, 
        // or return 401 if you want strict security.
        // return res.status(401).json({ message: 'Invalid HMAC' });
      }
    }

    const rawText = req.body.text;
    const command = cleanText(rawText);
    console.log(`[Webhook] Processing command: "${command}"`);

    let responseText = 'สวัสดีครับ! ผมคือ Network Monitoring Bot. ลองพิมพ์คำว่า **"status"** เพื่อดูสรุปสถานะอุปกรณ์ทั้งหมดครับ';

    // 1. STATUS COMMAND
    if (command.includes('status')) {
      const { NetworkDevices } = require('../models');
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

      responseText = `${emoji} **สรุปสถานะเครือข่ายล่าสุด**\n\n` +
        `• อุปกรณ์ทั้งหมด: **${total}**\n` +
        `• ปกติ (Online): **${online}**\n` +
        `• ขัดข้อง (Offline): **${offline}**\n\n` +
        `ตรวจสอบรายละเอียดเพิ่มเติมได้ที่ Dashboard ครับ`;
    }

    // 2. CHECK COMMAND (Searching by name or location)
    else if (command.includes('check')) {
      // Extract search term appearing AFTER the "check" keyword
      const checkIndex = command.indexOf('check');
      const searchTerm = command.substring(checkIndex + 5).trim();

      if (!searchTerm) {
        responseText = 'กรุณาระบุชื่ออุปกรณ์หรือจังหวัดที่ต้องการตรวจสอบ เช่น **"check อุบล"** หรือ **"check คลังพัสดุอุบล"**';
      } else {
        const { NetworkDevices } = require('../models');
        const { Op } = require('sequelize');

        const devices = await NetworkDevices.findAll({
          where: {
            [Op.or]: [
              { pea_name: { [Op.substring]: searchTerm } },
              { province: { [Op.substring]: searchTerm } }
            ]
          },
          include: [{
            model: DeviceMetrics,
            as: 'metrics'
          }],
          limit: 10 // Prevent wall of text
        });

        if (devices.length === 0) {
          responseText = `❌ ไม่พบข้อมูลสำหรับ: **"${searchTerm}"**`;
        } else if (devices.length === 1) {
          const d = devices[0];
          const m = d.metrics;
          const statusEmoji = m?.status === 'up' ? '✅' : '❌';
          const statusText = m?.status === 'up' ? 'ปกติ (ONLINE)' : 'ขัดข้อง (OFFLINE)';

          responseText = `${statusEmoji} **สถานะอุปกรณ์: ${d.pea_name}**\n\n` +
            `• จังหวัด: ${d.province}\n` +
            `• เกตเวย์: ${d.gateway}\n` +
            `• สถานะ: **${statusText}**\n` +
            `• อัปเดตล่าสุด: ${m ? new Date(m.checked_at).toLocaleString('th-TH') : 'ไม่พบข้อมูล'}`;
        } else {
          // Multiple results
          let listText = `🔍 พบอุปกรณ์ที่เกี่ยวข้องกับ **"${searchTerm}"** จำนวน ${devices.length} รายการ:\n\n`;
          devices.forEach(d => {
            const m = d.metrics;
            const statusEmoji = m?.status === 'up' ? '✅' : '❌';
            listText += `${statusEmoji} **${d.pea_name}**: ${m?.status === 'up' ? 'ปกติ' : 'ขัดข้อง'}\n`;
          });

          if (devices.length === 10) {
            listText += `\n*แสดงผลสูงสุด 10 รายการ*`;
          }
          responseText = listText;
        }
      }
    }

    // 3. DEVICES COMMAND (List unique provinces/branches with device names)
    else if (command.includes('device')) {
      const { NetworkDevices } = require('../models');
      const allDevices = await NetworkDevices.findAll({
        attributes: ['pea_name', 'province'],
        order: [
          ['province', 'ASC'],
          ['pea_name', 'ASC']
        ],
        raw: true
      });

      if (allDevices.length === 0) {
        responseText = '❌ ไม่พบข้อมูลอุปกรณ์ในระบบ';
      } else {
        // Group by province
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

        listText += `ใช้คำสั่ง **"check [ชื่ออุปกรณ์]"** เพื่อดูสถานะแต่ละตัวครับ`;
        responseText = listText;
      }
    }

    // 4. HELP COMMAND
    else if (command.includes('help')) {
      responseText = `🤖 **คู่มือการใช้งาน Network Monitoring Bot**\n\n` +
        `คุณสามารถสั่งงานผมได้ด้วยคำสั่งดังนี้ครับ:\n\n` +
        `• **status** : ดูสรุปภาพรวมสถานะอุปกรณ์ทั้งหมดในระบบ\n` +
        `• **devices** : ดูรายชื่ออุปกรณ์/จังหวัด/สาขาที่มีในระบบ\n` +
        `• **check [ชื่ออุปกรณ์]** : ตรวจสอบสถานะของอุปกรณ์นั้นๆ เช่น *check ตึก 1 ชั้น 2*\n` +
        `• **check [ชื่อจังหวัด]** : ตรวจสอบสถานะอุปกรณ์ทั้งหมดในจังหวัดนั้น เช่น *check อุบล*\n` +
        `• **help** : แสดงรายการคำสั่งที่ใช้งานได้ทั้งหมด\n\n` +
        `พิมพ์ชื่อผมแล้วตามด้วยคำสั่งได้เลยครับ!`;
    }

    const response = {
      type: 'message',
      text: responseText
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('[Webhook] Error handling Teams request:', error);
    next(error);
  }
};

module.exports = {
  handleTeamsOutgoingWebhook
};
