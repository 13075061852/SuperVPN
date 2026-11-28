package app.supervpn.android.data

import java.net.IDN
import java.net.URI

/**
 * Curated domestic direct domains synced with desktop shared/default-website-rules.js.
 * Suffix rules cover subdomains without blanket .cn or IP geolocation bypass.
 */
object DefaultWebsiteRules {
    const val SEED_VERSION = 2
    private const val MAX_RULES = 1000

    private val DEPRECATED_DOMESTIC_DIRECT_DOMAINS: Set<String> = setOf(
        "qwen.cn", "tencentcloud.com", "tongyi.aliyun.com", "cloud.tencent.com",
        "kimi.moonshot.cn", "dingding.xin", "miui.com",
    )

    private val DOMESTIC_DIRECT_DOMAINS_V2: List<String> = listOf(
        // Office, cloud drives, recruitment and enterprise tools
        "tencent.com", "alipan.com", "aliyundrive.com", "quark.cn", "baidupcs.com", "123pan.com",
        "xunlei.com", "yuque.com", "shimo.im", "wpscdn.cn", "zhipin.com", "tianyancha.com", "qcc.com",
        // Finance, banking, payments and securities
        "icbc.com.cn", "ccb.com", "abchina.com", "abchina.com.cn", "boc.cn", "cmbchina.com",
        "bankcomm.com", "psbc.com", "pingan.com", "unionpay.com", "95516.com",
        "eastmoney.com", "10jqka.com.cn", "xueqiu.com",
        // Social, communities and news
        "sina.cn", "douban.com", "doubanio.com", "hupu.com", "nga.cn", "ngabbs.com",
        "smzdm.com", "sspai.com", "ithome.com", "36kr.com", "thepaper.cn", "ifeng.com",
        // Entertainment, live streaming, audio and domestic gaming
        "bilivideo.cn", "huya.com", "douyu.com", "douyucdn.cn", "ximalaya.com", "xmcdn.com",
        "qidian.com", "mihoyo.com", "miyoushe.com", "taptap.cn", "4399.com", "xiaoheihe.cn",
        // Shopping, logistics, travel and local life
        "goofish.com", "1688.com", "vip.com", "dewu.com", "sf-express.com", "cainiao.com",
        "kuaidi100.com", "xiaojukeji.com", "didiglobal.com", "fliggy.com", "ly.com", "ke.com", "lianjia.com",
        // Education, academic and campus mirrors
        "edu.cn", "cnki.net", "chaoxing.com", "icourse163.org", "chsi.com.cn",
        // Domestic AI, cloud storage/CDN, developer mirrors and devices
        "moonshot.cn", "aliyuncs.com", "myqcloud.com", "qcloud.com", "volcengine.com", "baidubce.com",
        "qiniu.com", "qiniucdn.com", "modelscope.cn", "xfyun.cn", "siliconflow.cn",
        "minimaxi.com", "hailuoai.com", "npmmirror.com", "segmentfault.com", "rainyun.com", "lenovo.com.cn",
    )

    val DOMESTIC_DIRECT_DOMAINS: List<String> = listOf(
        // Search and information
        "baidu.com", "bdstatic.com", "bdimg.com", "bcebos.com",
        "sogou.com", "sogoucdn.com", "so.com", "360.cn", "360.com",
        "sohu.com", "sina.com.cn", "sinaimg.cn", "weibo.com", "weibo.cn", "zhihu.com", "zhimg.com",
        "toutiao.com", "toutiaoimg.com", "xinhuanet.com", "people.com.cn", "gov.cn",
        // Tencent domestic services, mail and office
        "qq.com", "qpic.cn", "qlogo.cn", "gtimg.com", "weixin.com", "wechatpay.cn",
        "163.com", "126.com", "yeah.net", "netease.com", "127.net", "126.net",
        "wps.cn", "kdocs.cn", "feishu.cn", "feishucdn.com", "dingtalk.com",
        // Video, music and their domestic media domains
        "bilibili.com", "b23.tv", "bilivideo.com", "hdslb.com",
        "douyin.com", "douyinvod.com", "douyinpic.com", "douyinstatic.com", "iesdouyin.com",
        "ixigua.com", "ixiguavideo.com", "pstatp.com",
        "kuaishou.com", "gifshow.com", "kwaicdn.com", "ksapisrv.com",
        "iqiyi.com", "iqiyipic.com", "qiyi.com", "youku.com", "ykimg.com", "cctv.com", "cctv.cn", "cctvpic.com",
        "mgtv.com", "hitv.com", "kugou.com", "kuwo.cn",
        // Shopping, payments, travel and local services
        "taobao.com", "tmall.com", "tb.cn", "alicdn.com", "alipay.com", "alipayobjects.com",
        "jd.com", "jd.hk", "360buyimg.com", "jdpay.com", "pinduoduo.com", "yangkeduo.com", "pddpic.com",
        "meituan.com", "meituan.net", "dianping.com", "dpfile.com", "ele.me", "eleme.cn",
        "xiaohongshu.com", "xhscdn.com", "xhslink.com", "amap.com", "autonavi.com",
        "ctrip.com", "tripcdn.cn", "qunar.com", "12306.cn",
        // Domestic AI, cloud consoles and development communities
        "deepseek.com", "doubao.com", "coze.cn", "kimi.com",
        "tongyi.com", "qianwen.com", "chatglm.cn", "bigmodel.cn",
        "aliyun.com", "huaweicloud.com",
        "gitee.com", "csdn.net", "cnblogs.com", "juejin.cn", "oschina.net",
        // Common domestic device ecosystems
        "mi.com", "xiaomi.com", "huawei.com", "honor.com", "oppo.com", "vivo.com",
        // Office, cloud drives, recruitment and enterprise tools
        "tencent.com", "alipan.com", "aliyundrive.com", "quark.cn", "baidupcs.com", "123pan.com",
        "xunlei.com", "yuque.com", "shimo.im", "wpscdn.cn", "zhipin.com", "tianyancha.com", "qcc.com",
        // Finance, banking, payments and securities
        "icbc.com.cn", "ccb.com", "abchina.com", "abchina.com.cn", "boc.cn", "cmbchina.com",
        "bankcomm.com", "psbc.com", "pingan.com", "unionpay.com", "95516.com",
        "eastmoney.com", "10jqka.com.cn", "xueqiu.com",
        // Social, communities and news
        "sina.cn", "douban.com", "doubanio.com", "hupu.com", "nga.cn", "ngabbs.com",
        "smzdm.com", "sspai.com", "ithome.com", "36kr.com", "thepaper.cn", "ifeng.com",
        // Entertainment, live streaming, audio and domestic gaming
        "bilivideo.cn", "huya.com", "douyu.com", "douyucdn.cn", "ximalaya.com", "xmcdn.com",
        "qidian.com", "mihoyo.com", "miyoushe.com", "taptap.cn", "4399.com", "xiaoheihe.cn",
        // Shopping, logistics, travel and local life
        "goofish.com", "1688.com", "vip.com", "dewu.com", "sf-express.com", "cainiao.com",
        "kuaidi100.com", "xiaojukeji.com", "didiglobal.com", "fliggy.com", "ly.com", "ke.com", "lianjia.com",
        // Education, academic and campus mirrors
        "edu.cn", "cnki.net", "chaoxing.com", "icourse163.org", "chsi.com.cn",
        // Domestic AI, cloud storage/CDN, developer mirrors and devices
        "moonshot.cn", "aliyuncs.com", "myqcloud.com", "qcloud.com", "volcengine.com", "baidubce.com",
        "qiniu.com", "qiniucdn.com", "modelscope.cn", "xfyun.cn", "siliconflow.cn",
        "minimaxi.com", "hailuoai.com", "npmmirror.com", "segmentfault.com", "rainyun.com", "lenovo.com.cn",
    )

    private val ipv4Regex = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")
    private val labelRegex = Regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

    fun normalizeDomain(input: String): String {
        val raw = input.trim()
        require(raw.isNotEmpty()) { "请输入域名或网址" }
        require(raw.length <= 255) { "域名过长" }
        require(!raw.contains("@")) { "请勿输入包含凭据的网址" }

        val candidate = if (raw.contains("://")) {
            val uri = try { URI(raw) } catch (_: Exception) { throw IllegalArgumentException("网址格式无效") }
            uri.host ?: throw IllegalArgumentException("无法识别网址中的域名")
        } else {
            raw.substringBefore('/').substringBefore('?').substringBefore('#').substringBefore(':')
        }

        val cleaned = candidate.trim().removePrefix("*.").removePrefix(".").removeSuffix(".").lowercase()
        require(cleaned.isNotEmpty()) { "域名无效" }
        require(!ipv4Regex.matches(cleaned) && !cleaned.contains(':')) { "网站规则仅支持域名，不支持 IP 地址" }

        val ascii = try {
            IDN.toASCII(cleaned, IDN.ALLOW_UNASSIGNED).lowercase()
        } catch (_: Exception) {
            throw IllegalArgumentException("域名格式无效")
        }
        val labels = ascii.split('.')
        require(labels.size >= 2 && labels.all { labelRegex.matches(it) }) { "请输入有效域名，例如 example.com" }
        return ascii
    }

    fun seedIfNeeded(data: AppData, force: Boolean = false): AppData {
        val version = data.settings.domesticRulesVersion
        if (!force && version >= SEED_VERSION) return data
        val source = data.websiteRules
        val existing = if (!force && version >= 1) {
            source.filterNot { rule ->
                rule.domain.lowercase().removeSuffix(".") in DEPRECATED_DOMESTIC_DIRECT_DOMAINS &&
                    rule.id.startsWith("domestic-direct:") &&
                    rule.action == "direct" &&
                    rule.enabled
            }
        } else {
            source
        }
        val candidates = if (!force && version >= 1) DOMESTIC_DIRECT_DOMAINS_V2 else DOMESTIC_DIRECT_DOMAINS
        val domains = existing.map { it.domain.lowercase().removeSuffix(".") }.toMutableSet()
        val ids = existing.map { it.id }.toMutableSet()
        val additions = mutableListOf<WebsiteRule>()

        for (domain in candidates) {
            if (domains.contains(domain) || existing.any { domain.endsWith(".${it.domain.lowercase().removeSuffix(".")}") }) {
                continue
            }
            if (existing.size + additions.size >= MAX_RULES) break
            val base = "domestic-direct:$domain"
            var id = base
            var suffix = 0
            while (ids.contains(id)) id = "$base:${++suffix}"
            additions += WebsiteRule(id = id, domain = domain, action = "direct", enabled = true)
            ids += id
            domains += domain
        }

        return data.copy(
            websiteRules = existing + additions,
            settings = data.settings.copy(domesticRulesVersion = SEED_VERSION),
        )
    }
}
