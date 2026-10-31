const { X509Certificate } = require('node:crypto');
const { isIP } = require('node:net');
const { domainToASCII } = require('node:url');

// User-authorized compatibility applies ONLY to the isolated subscription
// session. Never register this verifier on defaultSession or set global TLS flags.
function subscriptionCertificateDecision(request, now = Date.now()) {
  // Chromium ERR_CERT_AUTHORITY_INVALID. Other failures retain normal validation.
  if (request.errorCode !== -202) return -3;
  try {
    const certificate = new X509Certificate(request.certificate.data);
    const start = Date.parse(certificate.validFrom), end = Date.parse(certificate.validTo);
    if (!Number.isFinite(start) || !Number.isFinite(end) || now < start || now > end) return -3;
    let hostname = request.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    const matched = isIP(hostname) ? certificate.checkIP(hostname) : certificate.checkHost(domainToASCII(hostname), { subject: 'never', partialWildcards: false, multiLabelWildcards: false });
    return matched ? 0 : -3;
  } catch { return -3; }
}
function createSubscriptionRequest(sessionApi) {
  const isolated = sessionApi.fromPartition('supervpn-subscription-download', { cache: false });
  isolated.setCertificateVerifyProc((request, callback) => callback(subscriptionCertificateDecision(request)));
  return (input, options) => isolated.fetch(input.toString(), { ...options, credentials: 'omit' });
}
module.exports = { subscriptionCertificateDecision, createSubscriptionRequest };
