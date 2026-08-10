const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { User } = require('../models');

/**
 * Redirect the browser to PEA SSO (Keycloak) to start the Authorization Code flow.
 */
const ssoLogin = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.SSO_CLIENT_ID,
    redirect_uri: process.env.SSO_REDIRECT_URI_CALLBACK,
    response_type: 'code',
    scope: 'openid profile'
  });

  res.redirect(`${process.env.SSO_AUTH_URL}?${params.toString()}`);
};

/**
 * Redirect the browser to PEA SSO's logout endpoint to end the Keycloak session too -
 * plain local logout (POST /api/auth/logout) only blacklists our own JWT and leaves
 * the SSO session active, so a fresh "Login with PEA SSO" click would silently
 * re-authenticate without prompting for credentials again. Frontend should call
 * POST /api/auth/logout first (to blacklist the local JWT), then navigate the
 * browser here as a full page navigation (not fetch/axios).
 */
const ssoLogout = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.SSO_CLIENT_ID,
    post_logout_redirect_uri: process.env.SSO_POST_LOGOUT_REDIRECT_URI,
    lockout: 'true'
  });

  res.redirect(`${process.env.SSO_LOGOUT_URL}?${params.toString()}`);
};

/**
 * Split PEA's "hr_dept_sap_full" org path (e.g. "|region|branch|div1|div2|department")
 * into { pea_branch, pea_division } - branch is the 2nd segment, department is the last one.
 */
const parseDeptPath = (hrDeptSapFull) => {
  const parts = (hrDeptSapFull || '').split('|').filter(p => p.trim() !== '');
  return {
    pea_branch: parts[1] || null,
    pea_division: parts[parts.length - 1] || null
  };
};

// New SSO users get 'operator' instead of the default 'user' when they belong to
// this specific branch AND one of these IT divisions.
const OPERATOR_BRANCH = 'การไฟฟ้าส่วนภูมิภาค เขต 2 (ภาคตะวันออกเฉียงเหนือ) จังหวัดอุบลราชธานี';
const OPERATOR_DIVISIONS = ['แผนกคอมพิวเตอร์และเครือข่าย', 'แผนกปฏิบัติงานดิจิทัล'];

/**
 * Default role for a brand-new SSO-provisioned user, based on their org path.
 */
const determineDefaultRole = (hrDeptSapFull) => {
  const deptFull = hrDeptSapFull || '';
  const inOperatorBranch = deptFull.includes(OPERATOR_BRANCH);
  const inOperatorDivision = OPERATOR_DIVISIONS.some(div => deptFull.includes(div));
  return (inOperatorBranch && inOperatorDivision) ? 'operator' : 'user';
};

/**
 * Find the local User matching this SSO identity by employee id, or provision a new
 * one if none exists yet (role defaults to 'user', or 'operator' for the IT branch/
 * division per determineDefaultRole). Existing users keep their role untouched (so
 * pre-provisioned accounts like super_admin keep their assigned access), but
 * pea_branch/pea_division/position are refreshed from SSO on every login if PEA's
 * HR data has moved them since we last saw them.
 */
const findOrProvisionUser = async (userinfo) => {
  const username = userinfo.hr_employee_id || userinfo.preferred_username;
  const { pea_branch, pea_division } = parseDeptPath(userinfo.hr_dept_sap_full);
  const position = userinfo.hr_position || null;

  const existing = await User.findOne({ where: { username } });
  if (existing) {
    const changes = {};
    if (pea_branch && pea_branch !== existing.pea_branch) changes.pea_branch = pea_branch;
    if (pea_division && pea_division !== existing.pea_division) changes.pea_division = pea_division;
    if (position && position !== existing.position) changes.position = position;

    if (Object.keys(changes).length > 0) {
      await existing.update(changes);
    }
    return existing;
  }

  return User.create({
    username,
    password_hash: crypto.randomBytes(32).toString('hex'), // random, unusable for local login; hashed by the model hook
    role: determineDefaultRole(userinfo.hr_dept_sap_full),
    first_name: userinfo.hr_firstname || null,
    last_name: userinfo.hr_lastname || null,
    pea_branch,
    pea_division,
    position
  });
};

/**
 * OAuth callback: exchange the code for a token, fetch userinfo, map to a local User,
 * then issue our own JWT the same way the local /login endpoint does.
 */
const ssoCallback = async (req, res, next) => {
  try {
    const { code, error, error_description } = req.query;
    const frontendUrl = process.env.FRONTEND_SSO_CALLBACK_URL;

    if (error) {
      if (frontendUrl) {
        return res.redirect(`${frontendUrl}#error=${encodeURIComponent(error_description || error)}`);
      }
      return res.status(400).json({ success: false, error, error_description });
    }

    if (!code) {
      return res.status(400).json({ success: false, message: 'No code provided' });
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.SSO_CLIENT_ID,
      client_secret: process.env.SSO_CLIENT_SECRET,
      redirect_uri: process.env.SSO_REDIRECT_URI_CALLBACK
    });

    const tokenRes = await fetch(process.env.SSO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });
    const tokenJson = await tokenRes.json();

    if (!tokenJson.access_token) {
      if (frontendUrl) {
        return res.redirect(`${frontendUrl}#error=sso_token_failed`);
      }
      return res.status(400).json({ success: false, message: 'Failed to get access token from SSO', tokenJson });
    }

    const userinfoRes = await fetch(process.env.SSO_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    const userinfo = await userinfoRes.json();

    const user = await findOrProvisionUser(userinfo);

    const jwtToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    const userPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      pea_branch: user.pea_branch,
      pea_division: user.pea_division,
      position: user.position
    };

    if (frontendUrl) {
      const fragment = new URLSearchParams({
        token: jwtToken,
        user: JSON.stringify(userPayload)
      });
      return res.redirect(`${frontendUrl}#${fragment.toString()}`);
    }

    // FRONTEND_SSO_CALLBACK_URL not configured yet - fall back to a JSON response for local testing
    res.status(200).json({
      success: true,
      token: jwtToken,
      user: userPayload
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { ssoLogin, ssoLogout, ssoCallback };
