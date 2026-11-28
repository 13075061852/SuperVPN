// Curated domestic service domains, not a blanket .cn / IP geolocation bypass.
// Suffix rules cover subdomains; international services such as TikTok are not
// included merely because they share an operator with a domestic service.
export const DEPRECATED_DOMESTIC_DIRECT_DOMAINS = Object.freeze([
  'qwen.cn',           // Dead DNS (SERVFAIL); covered by tongyi.com / qianwen.com / aliyun.com
  'tencentcloud.com',  // Overseas Tencent Cloud International; domestic uses tencent.com / myqcloud.com / qcloud.com
  'tongyi.aliyun.com', // Redundant subdomain already covered by aliyun.com
  'cloud.tencent.com', // Superseded by parent tencent.com (also covers meeting/yuanbao)
  'kimi.moonshot.cn',  // Superseded by parent moonshot.cn (also covers platform/api)
  'dingding.xin',      // Deprecated auxiliary domain; DingTalk uses dingtalk.com
  'miui.com',          // Legacy MIUI domain; Xiaomi HyperOS uses mi.com / xiaomi.com
]);

const DOMESTIC_DIRECT_DOMAINS_V1_KEPT = [
  // Search and information
  'baidu.com', 'bdstatic.com', 'bdimg.com', 'bcebos.com',
  'sogou.com', 'sogoucdn.com', 'so.com', '360.cn', '360.com',
  'sohu.com', 'sina.com.cn', 'sinaimg.cn', 'weibo.com', 'weibo.cn', 'zhihu.com', 'zhimg.com',
  'toutiao.com', 'toutiaoimg.com', 'xinhuanet.com', 'people.com.cn', 'gov.cn',
  // Tencent domestic services, mail and office
  'qq.com', 'qpic.cn', 'qlogo.cn', 'gtimg.com', 'weixin.com', 'wechatpay.cn',
  '163.com', '126.com', 'yeah.net', 'netease.com', '127.net', '126.net',
  'wps.cn', 'kdocs.cn', 'feishu.cn', 'feishucdn.com', 'dingtalk.com',
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
  'deepseek.com', 'doubao.com', 'coze.cn', 'kimi.com',
  'tongyi.com', 'qianwen.com', 'chatglm.cn', 'bigmodel.cn',
  'aliyun.com', 'huaweicloud.com',
  'gitee.com', 'csdn.net', 'cnblogs.com', 'juejin.cn', 'oschina.net',
  // Common domestic device ecosystems
  'mi.com', 'xiaomi.com', 'huawei.com', 'honor.com', 'oppo.com', 'vivo.com',
];

export const DOMESTIC_DIRECT_DOMAINS_V2 = Object.freeze([
  // Office, cloud drives, recruitment and enterprise tools
  'tencent.com', 'alipan.com', 'aliyundrive.com', 'quark.cn', 'baidupcs.com', '123pan.com',
  'xunlei.com', 'yuque.com', 'shimo.im', 'wpscdn.cn', 'zhipin.com', 'tianyancha.com', 'qcc.com',
  // Finance, banking, payments and securities
  'icbc.com.cn', 'ccb.com', 'abchina.com', 'abchina.com.cn', 'boc.cn', 'cmbchina.com',
  'bankcomm.com', 'psbc.com', 'pingan.com', 'unionpay.com', '95516.com',
  'eastmoney.com', '10jqka.com.cn', 'xueqiu.com',
  // Social, communities and news
  'sina.cn', 'douban.com', 'doubanio.com', 'hupu.com', 'nga.cn', 'ngabbs.com',
  'smzdm.com', 'sspai.com', 'ithome.com', '36kr.com', 'thepaper.cn', 'ifeng.com',
  // Entertainment, live streaming, audio and domestic gaming
  'bilivideo.cn', 'huya.com', 'douyu.com', 'douyucdn.cn', 'ximalaya.com', 'xmcdn.com',
  'qidian.com', 'mihoyo.com', 'miyoushe.com', 'taptap.cn', '4399.com', 'xiaoheihe.cn',
  // Shopping, logistics, travel and local life
  'goofish.com', '1688.com', 'vip.com', 'dewu.com', 'sf-express.com', 'cainiao.com',
  'kuaidi100.com', 'xiaojukeji.com', 'didiglobal.com', 'fliggy.com', 'ly.com', 'ke.com', 'lianjia.com',
  // Education, academic and campus mirrors
  'edu.cn', 'cnki.net', 'chaoxing.com', 'icourse163.org', 'chsi.com.cn',
  // Domestic AI, cloud storage/CDN, developer mirrors and devices
  'moonshot.cn', 'aliyuncs.com', 'myqcloud.com', 'qcloud.com', 'volcengine.com', 'baidubce.com',
  'qiniu.com', 'qiniucdn.com', 'modelscope.cn', 'xfyun.cn', 'siliconflow.cn',
  'minimaxi.com', 'hailuoai.com', 'npmmirror.com', 'segmentfault.com', 'rainyun.com', 'lenovo.com.cn',
]);

export const DOMESTIC_DIRECT_DOMAINS = Object.freeze([
  ...DOMESTIC_DIRECT_DOMAINS_V1_KEPT,
  ...DOMESTIC_DIRECT_DOMAINS_V2,
]);

const SEED_VERSION = 2;
const deprecatedSet = new Set(DEPRECATED_DOMESTIC_DIRECT_DOMAINS);
const cleanDomain = value => String(value).toLowerCase().replace(/\.$/, '');

export function seedDomesticWebsiteRules(state) {
  // This marker deliberately does not live in defaultState: merging an old
  // saved profile with defaults must not accidentally skip its migration.
  const version = Number(state.domesticWebsiteRulesVersion) || 0;
  if (version >= SEED_VERSION) return state;
  const source = state.websiteRules || [];
  if (!Array.isArray(source)) throw new Error('网站规则数据无效');
  // On v1 -> v2 upgrade, prune only untouched auto-seeded deprecated entries;
  // never remove user-added, customized or disabled rules.
  const existing = version >= 1
    ? source.filter(rule => !(deprecatedSet.has(cleanDomain(rule.domain)) && typeof rule.id === 'string' && rule.id.startsWith('domestic-direct:') && rule.action === 'direct' && rule.enabled !== false))
    : source;
  // On v1 -> v2 upgrade, add only newly introduced v2 presets so any v1 preset
  // the user explicitly deleted stays deleted.
  const candidates = version >= 1 ? DOMESTIC_DIRECT_DOMAINS_V2 : DOMESTIC_DIRECT_DOMAINS;
  const domains = new Set(existing.map(rule => cleanDomain(rule.domain)));
  const ids = new Set(existing.map(rule => rule.id));
  const additions = [];
  for (const domain of candidates) {
    if (domains.has(domain) || existing.some(rule => domain.endsWith(`.${cleanDomain(rule.domain)}`))) continue; // Also preserve broader user exceptions.
    if (existing.length + additions.length >= 1000) break;
    const base = `domestic-direct:${domain}`;
    let id = base, suffix = 0;
    while (ids.has(id)) id = `${base}:${++suffix}`;
    additions.push({ id, domain, action: 'direct', enabled: true });
    ids.add(id); domains.add(domain);
  }
  return { ...state, websiteRules: [...existing, ...additions], domesticWebsiteRulesVersion: SEED_VERSION };
}
