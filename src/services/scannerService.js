const ping = require('ping');
const { exec } = require('child_process');
const ipLib = require('ip');
const dns = require('dns').promises;

/**
 * Service to scan a subnet and discover active clients
 */
const scanSubnet = async (networkId, subnetMask) => {
  console.log(`[ScannerService] Scanning ${networkId}${subnetMask}...`);
  
  try {
    let subnetStr = networkId;
    if (subnetMask) {
      if (subnetMask.startsWith('/')) {
        subnetStr = `${networkId}${subnetMask}`;
      } else if (subnetMask.includes('.')) {
        // Handle full mask like 255.255.255.0
        subnetStr = `${networkId}/${ipLib.fromPrefixLen(ipLib.maskToCIDR(subnetMask))}`;
      } else if (!isNaN(subnetMask)) {
        // Handle numeric mask like 24
        subnetStr = `${networkId}/${subnetMask}`;
      } else {
        subnetStr = `${networkId}${subnetMask}`;
      }
    }
    
    const subnet = ipLib.cidrSubnet(subnetStr);
    const offsetHours = process.env.DB_TIMEZONE_OFFSET !== undefined ? parseInt(process.env.DB_TIMEZONE_OFFSET) : 0;
    const checkedAt = new Date(new Date().getTime() + offsetHours * 60 * 60 * 1000);
    
    const firstIP = ipLib.toLong(subnet.firstAddress);
    const lastIP = ipLib.toLong(subnet.lastAddress);
    const ips = [];
    for (let i = firstIP; i <= lastIP; i++) {
        ips.push(ipLib.fromLong(i));
    }

    console.log(`[ScannerService] Pinging ${ips.length} IPs...`);
    
    // Ping all IPs and capture results
    const activeIps = new Set();
    const isWin = process.platform === 'win32';
    const pingBatchSize = 50; 
    const pingOptions = isWin ? ['-n', '1'] : ['-c', '1'];

    for (let i = 0; i < ips.length; i += pingBatchSize) {
      const batch = ips.slice(i, i + pingBatchSize);
      const pingResults = await Promise.all(batch.map(target => 
        ping.promise.probe(target, { timeout: 2, extra: pingOptions })
      ));
      pingResults.forEach(r => {
        if (r.alive) activeIps.add(r.host);
      });
    }

    console.log(`[ScannerService] Ping sweep complete. Found ${activeIps.size} responsive IPs.`);
    
    const arpData = await getArpTable();
    const finalResults = [];
    const discoveryBatchSize = 20;
    const activeIpList = Array.from(activeIps);

    for (let i = 0; i < activeIpList.length; i += discoveryBatchSize) {
      const batch = activeIpList.slice(i, i + discoveryBatchSize);
      const batchResults = await Promise.all(batch.map(async (targetIp) => {
        const mac = arpData[targetIp];
        let clientName = null;

        // Try Reverse DNS (Quickest)
        try {
          const nameRes = await dns.reverse(targetIp);
          clientName = nameRes[0];
        } catch (e) {
          if (isWin) {
            clientName = await new Promise(resolve => {
              exec(`ping -a ${targetIp} -n 1`, (err, stdout) => {
                if (err) return resolve(null);
                const match = stdout.match(/Pinging ([\w\.\-]+) \[/i);
                resolve(match ? match[1] : null);
              });
            });
          }
        }
        
        // Try Windows nbtstat (Best for name + mac on local subnet)
        if (isWin && (!clientName || !mac)) {
          const nbtInfo = await getNbtStatInfo(targetIp);
          if (nbtInfo.name) clientName = nbtInfo.name;
          if (nbtInfo.mac) mac = nbtInfo.mac;
        }

        if (!clientName) {
          clientName = `Device-${targetIp.replace(/\./g, '-')}`;
        }

        return {
          ip_address: targetIp,
          mac_address: mac || `IP-${targetIp}`,
          client_name: clientName,
          checked_at: checkedAt
        };
      }));
      finalResults.push(...batchResults);
    }

    console.log(`[ScannerService] Found ${finalResults.length} active clients.`);
    return finalResults;
  } catch (error) {
    console.error('[ScannerService] Scan failed:', error);
    throw error;
  }
};

/**
 * Normalizes a MAC address string to standard format: 00:11:22:33:44:55
 */
const normalizeMac = (rawMac) => {
  if (!rawMac) return null;
  return rawMac.replace(/-/g, ':')
               .split(':')
               .map(part => part.padStart(2, '0'))
               .join(':')
               .toLowerCase();
};

/**
 * Get NetBIOS info and MAC address using nbtstat -A
 */
const getNbtStatInfo = (ip) => {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ name: null, mac: null });

    exec(`nbtstat -A ${ip}`, (err, stdout) => {
      if (err || !stdout) return resolve({ name: null, mac: null });

      // Find first UNIQUE name (usually the computer name)
      const nameMatch = stdout.match(/^\s*([\w\-]+)\s+<00>\s+UNIQUE/m);
      // Find MAC Address
      const macMatch = stdout.match(/MAC Address\s*=\s*([a-f\d\-]{17})/i);

      resolve({
        name: nameMatch ? nameMatch[1] : null,
        mac: macMatch ? normalizeMac(macMatch[1]) : null
      });
    });
  });
};

/**
 * Get ARP table as an object: { "IP": "MAC" }
 */
const getArpTable = () => {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const command = 'arp -a';
    exec(command, (error, stdout) => {
      if (error) {
        console.error('[ScannerService] ARP command failed:', error);
        return resolve({});
      }

      const arpMap = {};
      const lines = stdout.split('\n');
      
      const macRegex = /\(([\d\.]+)\) at ([a-f\d:]+)/i;
      const linuxRegex = /([\d\.]+)\s+at\s+([a-f\d:]+)/i;
      // Windows regex improved: non-anchored to handle varied headers
      const winRegex = /([\d\.]+)\s+([a-f\d\-]{17})\s+dynamic/i;

      lines.forEach(line => {
        const match = isWin ? line.match(winRegex) : (line.match(macRegex) || line.match(linuxRegex));
        if (match) {
          const ip = match[1];
          arpMap[ip] = normalizeMac(match[2]);
        }
      });

      resolve(arpMap);
    });
  });
};

module.exports = {
  scanSubnet,
  getNbtStatInfo,
  normalizeMac
};
