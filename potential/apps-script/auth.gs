/**
 * auth.gs — security helpers for the potential clients portal.
 * Mirrors clients/apps-script/auth.js (PBKDF2-SHA256 passwords + HS256 JWT).
 *
 * Bootstrap from the editor:
 *   _adminAuthBootstrap          generates JWT_SECRET if missing
 *   _adminMigrateAllPasswords    bulk-hashes any remaining plain passwords
 */

const PBKDF2_ITERS    = 100000;
const PBKDF2_SALT_LEN = 16;
const JWT_TTL_SECONDS = 24 * 60 * 60;

function _bytesToB64(bytes){ return Utilities.base64Encode(bytes); }
function _b64ToBytes(b64){ return Utilities.base64Decode(b64); }
function _bytesToB64Url(bytes){ return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function _b64UrlToBytes(b64url){
  const pad = b64url.length % 4 ? '='.repeat(4 - (b64url.length % 4)) : '';
  return Utilities.base64DecodeWebSafe(b64url + pad);
}
function _strToBytes(s){ return Utilities.newBlob(s).getBytes(); }
function _bytesToStr(bytes){ return Utilities.newBlob(bytes).getDataAsString(); }

function _randomBytes(n){
  const seed = Utilities.getUuid() + ':' + Date.now() + ':' + Math.random();
  const dig = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  const out = [];
  let cur = dig;
  while(out.length < n){
    for(let i=0; i<cur.length && out.length<n; i++) out.push(cur[i]);
    cur = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, cur);
  }
  return out;
}

function _pbkdf2Sha256(passwordStr, saltBytes, iterations){
  const block1 = saltBytes.concat([0, 0, 0, 1]);
  let u = Utilities.computeHmacSha256Signature(block1, passwordStr);
  const t = u.slice();
  for(let i=1; i<iterations; i++){
    u = Utilities.computeHmacSha256Signature(u, passwordStr);
    for(let j=0; j<t.length; j++) t[j] ^= u[j];
  }
  return t;
}

function _hashPassword(plainPassword, optSaltBytes){
  if(!plainPassword || typeof plainPassword !== 'string') throw new Error('סיסמה חסרה');
  const salt = optSaltBytes && optSaltBytes.length === PBKDF2_SALT_LEN
    ? optSaltBytes
    : _randomBytes(PBKDF2_SALT_LEN);
  const hash = _pbkdf2Sha256(plainPassword, salt, PBKDF2_ITERS);
  return 'pbkdf2$' + PBKDF2_ITERS + '$' + _bytesToB64(salt) + '$' + _bytesToB64(hash);
}

function _verifyPassword(plainPassword, stored){
  if(!stored) return false;
  const s = String(stored).trim();
  if(!s) return false;
  if(s.indexOf('pbkdf2$') === 0){
    const parts = s.split('$');
    if(parts.length !== 4) return false;
    const iters = parseInt(parts[1], 10) || PBKDF2_ITERS;
    const salt  = _b64ToBytes(parts[2]);
    const expected = _b64ToBytes(parts[3]);
    const got = _pbkdf2Sha256(plainPassword, salt, iters);
    if(got.length !== expected.length) return false;
    let diff = 0;
    for(let i=0; i<got.length; i++) diff |= (got[i] ^ expected[i]);
    return diff === 0;
  }
  return s === String(plainPassword).trim();
}

function _isHashedFormat(stored){
  return typeof stored === 'string' && stored.indexOf('pbkdf2$') === 0;
}

function _getJwtSecret(){
  const s = PropertiesService.getScriptProperties().getProperty('JWT_SECRET');
  if(!s) throw new Error('JWT_SECRET לא הוגדר. הפעל _adminAuthBootstrap מהעורך.');
  return s;
}

function _jwtSign(payload){
  const header = {alg:'HS256', typ:'JWT'};
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = Object.assign({iat: now, exp: now + JWT_TTL_SECONDS}, payload);
  const h = _bytesToB64Url(_strToBytes(JSON.stringify(header)));
  const p = _bytesToB64Url(_strToBytes(JSON.stringify(fullPayload)));
  const data = h + '.' + p;
  const sig = Utilities.computeHmacSha256Signature(data, _getJwtSecret());
  return data + '.' + _bytesToB64Url(sig);
}

function _jwtVerify(token){
  if(!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if(parts.length !== 3) return null;
  let secret;
  try { secret = _getJwtSecret(); } catch(_){ return null; }
  const expected = Utilities.computeHmacSha256Signature(parts[0] + '.' + parts[1], secret);
  const expectedB64 = _bytesToB64Url(expected);
  if(expectedB64.length !== parts[2].length) return null;
  let diff = 0;
  for(let i=0; i<expectedB64.length; i++) diff |= expectedB64.charCodeAt(i) ^ parts[2].charCodeAt(i);
  if(diff !== 0) return null;
  let payload;
  try { payload = JSON.parse(_bytesToStr(_b64UrlToBytes(parts[1]))); }
  catch(_){ return null; }
  if(payload.exp && Math.floor(Date.now()/1000) > payload.exp) return null;
  return payload;
}

function _adminAuthBootstrap(){
  const props = PropertiesService.getScriptProperties();
  if(props.getProperty('JWT_SECRET')){
    return 'JWT_SECRET כבר קיים. אין צורך לעשות כלום.';
  }
  const secret = _bytesToB64(_randomBytes(32));
  props.setProperty('JWT_SECRET', secret);
  return 'JWT_SECRET נוצר ונשמר ב-Script Properties.';
}

function _adminMigrateAllPasswords(){
  const sheet = _sheet();
  const lastRow = sheet.getLastRow();
  if(lastRow < 2) return 'אין נתונים לעדכן.';
  const range = sheet.getRange(2, COL.CS_PASS, lastRow - 1, 1);
  const vals  = range.getValues();
  let hashed = 0, skipped = 0, empty = 0;
  for(let i=0; i<vals.length; i++){
    const cur = (vals[i][0] || '').toString().trim();
    if(!cur){ empty++; continue; }
    if(_isHashedFormat(cur)){ skipped++; continue; }
    vals[i][0] = _hashPassword(cur);
    hashed++;
  }
  range.setValues(vals);
  return 'הסתיים: ' + hashed + ' hashing, ' + skipped + ' כבר hashed, ' + empty + ' ריקים.';
}
