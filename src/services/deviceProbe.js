const ping = require('ping');

/**
 * The one place a network device gets probed - shared by the background ping loop
 * (pingService.js) and the on-demand GET/POST /api/latency/check/:id, which used to
 * each carry their own copy of this logic (and the on-demand copy had no retry).
 */

const PACKETS_SENT = 3;
const PROBE_OPTIONS = { timeout: 5, extra: ['-n', String(PACKETS_SENT)] };
const RETRY_DELAY_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Packet loss counted from real echo replies only.
 *
 * Don't use the ping library's `packetLoss` - it's parsed from Windows' own summary
 * line, and Windows counts a "Reply from <router>: Destination host unreachable" as a
 * received packet. A host that never answered can then show e.g. 33% loss, and a host
 * that answered 2 of 3 with the third coming back "unreachable" shows 0%. The library's
 * `times` array is built only from lines carrying bytes=/time=/TTL=, i.e. genuine
 * echo replies, so it's the accurate count.
 */
const echoLossPercent = (result, sent = PACKETS_SENT) => {
  const received = Array.isArray(result && result.times) ? result.times.length : 0;
  return Math.round(((sent - Math.min(received, sent)) / sent) * 10000) / 100;
};

const probeIp = async (ip) => {
  try {
    return await ping.promise.probe(ip, PROBE_OPTIONS);
  } catch (err) {
    // The ping process itself failing is treated as "no reply", same as before this
    // refactor - see pingService.js history for why it must not escape to a catch that
    // skips the retry.
    console.error(`[DeviceProbe] Probe error for ${ip}:`, err.message);
    return { alive: false, times: [] };
  }
};

/**
 * Gateway first, then the FortiGate WAN IP if the gateway doesn't answer.
 * Returns the result that decides the outcome and which address produced it.
 */
const probeOnce = async (device) => {
  const gatewayResult = await probeIp(device.gateway);
  if (gatewayResult.alive || !device.wan_ip_fgt) {
    return { result: gatewayResult, probedIp: 'gateway' };
  }
  const wanResult = await probeIp(device.wan_ip_fgt);
  if (wanResult.alive) {
    console.log(`[DeviceProbe] ${device.pea_name}: Gateway down, but wan_ip_fgt is UP. Marking as UP.`);
    return { result: wanResult, probedIp: 'wan_ip_fgt' };
  }
  return { result: gatewayResult, probedIp: 'gateway' };
};

/**
 * Probe a device, retrying once a few seconds later before believing it's down - a
 * single transient failure used to be recorded as an outage for a whole ~20 min loop
 * cycle. A real outage still fails both attempts.
 *
 * measured_at is taken when the deciding probe finishes, per device - not the time
 * the batch started, which could be ~30s earlier for a device that needed the retry.
 */
const probeDevice = async (device) => {
  let attempts = 1;
  let outcome = await probeOnce(device);
  if (!outcome.result.alive) {
    await sleep(RETRY_DELAY_MS);
    attempts = 2;
    outcome = await probeOnce(device);
  }

  const { result, probedIp } = outcome;
  const latency = result.alive ? parseFloat(result.avg) : null;

  return {
    alive: !!result.alive,
    status: result.alive ? 'up' : 'down',
    latency_ms: Number.isFinite(latency) ? latency : null,
    packet_loss: echoLossPercent(result),
    probed_ip: probedIp,
    attempts,
    measured_at: new Date()
  };
};

module.exports = { probeDevice, echoLossPercent, PACKETS_SENT };
