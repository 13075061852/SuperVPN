// Curated domestic service domains, not a blanket .cn / IP geolocation bypass.
// Suffix rules cover subdomains; international services such as TikTok are not
// included merely because they share an operator with a domestic service.
export const DOMESTIC_DIRECT_DOMAINS = Object.freeze([
  // Search and information
  'baidu.com', 'bdstatic.com', 'bdimg.com', 'bcebos.com',
  'sogou.com', 'sogoucdn.com', 'so.com', '360.cn', '360.com',
  'sohu.com', 'sina.com.cn', 'sinaimg.cn', 'weibo.com', 'weibo.cn', 'zhihu.com', 'zhimg.com',
  'toutiao.com', 'toutiaoimg.com', 'xinhuanet.com', 'people.com.cn', 'gov.cn',
  // Tencent domestic services, mail and office
  'qq.com', 'qpic.cn', 'qlogo.cn', 'gtimg.com', 'weixin.com', 'wechatpay.cn',
  '163.com', '126.com', 'yeah.net', 'netease.com', '127.net', '126.net',
  'wps.cn', 'kdocs.cn', 'feishu.cn', 'feishucdn.com', 'dingtalk.com', 'dingding.xin',
  // Video, music and their domestic media domains
  'bilibili.com', 'b23.tv', 'bilivideo.com', 'hdslb.com',
  'douyin.com', 'douyinvod.com', 'douyinpic.com', 'douyinstatic.com', 'iesdouyin.com',
  'ixigua.com', 'ixiguavideo.com', 'pstatp.com',
  'kuaishou.com', 'gifshow.com', 'kwaicdn.com', 'ksapisrv.com',
  'iqiyi.com', 'iqiyipic.com', 'qiyi.com', 'youku.com', 'ykimg.com', 'cctv.com', 'cctv.cn', 'cctvpic.com',
  'mgtv.com', 'hitv.com', 'kugou.com', 'kuwo.cn',
  // Shopping, payments, travel and local services
  'taobao.com', 'tmall.com', 'tb.cn', 'alicdn.com', 'alipay.com', 'alipayobjects.com',
  'jd.com', 'jd.hk', '360buyimg.com', 'jdpay.com', 'pinduoduo.com', 'yangkeduo.com', 'pddpic.com',
  'meituan.com', 'meituan.net', 'dianping.com', 'dpfile.com', 'ele.me', 'eleme.cn',
  'xiaohongshu.com', 'xhscdn.com', 'xhslink.com', 'amap.com', 'autonavi.com',
  'ctrip.com', 'tripcdn.cn', 'qunar.com', '12306.cn',
  // Domestic AI, cloud consoles and development communities
  'deepseek.com', 'doubao.com', 'coze.cn', 'kimi.com', 'kimi.moonshot.cn',
  'tongyi.com', 'tongyi.aliyun.com', 'qianwen.com', 'qwen.cn', 'chatglm.cn', 'bigmodel.cn',
  'aliyun.com', 'tencentcloud.com', 'cloud.tencent.com', 'huaweicloud.com',
  'gitee.com', 'csdn.net', 'cnblogs.com', 'juejin.cn', 'oschina.net',
  // Common domestic device ecosystems
  'mi.com', 'xiaomi.com', 'miui.com', 'huawei.com', 'honor.com', 'oppo.com', 'vivo.com',
]);
const SEED_VERSION = 1;
export function seedDomesticWebsiteRules(state) {
  // This marker deliberately does not live in defaultState: merging an old
  // saved profile with defaults must not accidentally skip its first migration.
  if (state.domesticWebsiteRulesVersion >= SEED_VERSION) return state;
  const existing = state.websiteRules || [];
  if (!Array.isArray(existing)) throw new Error('网站规则数据无效');
  const domains = new Set(existing.map(rule => String(rule.domain).toLowerCase().replace(/\.$/, '')));
  const ids = new Set(existing.map(rule => rule.id));
  const additions = [];
  for (const domain of DOMESTIC_DIRECT_DOMAINS) {
    if (domains.has(domain) || existing.some(rule => domain.endsWith(`.${String(rule.domain).toLowerCase().replace(/\.$/, '')}`))) continue; // Also preserve broader user exceptions.
    if (existing.length + additions.length >= 1000) break;
    const base = `domestic-direct:${domain}`;
    let id = base, suffix = 0;
    while (ids.has(id)) id = `${base}:${++suffix}`;
    additions.push({ id, domain, action: 'direct', enabled: true });
    ids.add(id); domains.add(domain);
  }
  return { ...state, websiteRules: [...existing, ...additions], domesticWebsiteRulesVersion: SEED_VERSION };
}
