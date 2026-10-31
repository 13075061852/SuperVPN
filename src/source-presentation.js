// Show only subscription information actually supplied by the provider.
// A remaining quota is not a total quota: never invent a usage percentage.
export function subscriptionFacts(information = []) {
  const value = pattern => {
    const item = information.find(n => pattern.test(n.name));
    return item ? item.name.replace(/^[^：:]*[：:]\s*/, '').trim() : null;
  };
  return {
    remaining: value(/^剩余流量[：:]/),
    reset: value(/^(距离下次重置剩余|流量重置)[：:]/),
    expiry: value(/^(套餐到期|到期时间)[：:]/)
  };
}
