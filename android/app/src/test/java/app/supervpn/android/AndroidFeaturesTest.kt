package app.supervpn.android

import app.supervpn.android.data.AppData
import app.supervpn.android.data.ConfigBuilder
import app.supervpn.android.data.DefaultWebsiteRules
import app.supervpn.android.data.Node
import app.supervpn.android.data.NodePresentation
import app.supervpn.android.data.Settings
import app.supervpn.android.data.SpeedTester
import app.supervpn.android.data.Subscription
import app.supervpn.android.data.SubscriptionFetcher
import app.supervpn.android.data.SubscriptionUsage
import app.supervpn.android.data.WebsiteRule
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidFeaturesTest {
    private val sampleNode = Node(
        id = "n1",
        name = "香港-01",
        protocol = "VLESS",
        host = "hk.example.com",
        port = 443,
        outbound = JSONObject("""{"type":"vless","server":"hk.example.com","server_port":443,"uuid":"11111111-2222-3333-4444-555555555555","tls":{"enabled":true,"server_name":"hk.example.com"}}"""),
    )

    @Test
    fun parsesSubscriptionUsageHeaderAccurately() {
        val usage = SubscriptionFetcher.parseSubscriptionUsage(
            "upload=1048576; download=2097152; total=10737418240; expire=1893456000"
        )
        assertNotNull(usage)
        assertEquals(3145728L, usage!!.used)
        assertEquals(10737418240L, usage.total)
        assertEquals(1893456000L, usage.expire)
        assertTrue(usage.percent > 0f && usage.percent < 1f)

        assertNull(SubscriptionFetcher.parseSubscriptionUsage("upload=1; upload=2; download=3; total=4"))
        assertNull(SubscriptionFetcher.parseSubscriptionUsage("upload=abc; download=0; total=10"))
        assertNull(SubscriptionFetcher.parseSubscriptionUsage(null))
    }

    @Test
    fun distinguishesSubscriptionUrlsFromProxyLinks() {
        assertTrue(SubscriptionFetcher.looksLikeSubscriptionUrl("https://sub.example.com/api/v1/client/subscribe?token=abc"))
        assertFalse(SubscriptionFetcher.looksLikeSubscriptionUrl("vless://11111111-2222-3333-4444-555555555555@example.com:443#HK"))
        assertFalse(SubscriptionFetcher.looksLikeSubscriptionUrl("https://user:pass@proxy.example.com:443"))
        assertFalse(SubscriptionFetcher.looksLikeSubscriptionUrl("https://a.example.com/1\nhttps://b.example.com/2"))
    }

    @Test
    fun seedsDomesticRulesOnceAndNormalizesDomains() {
        val seeded = DefaultWebsiteRules.seedIfNeeded(AppData())
        assertEquals(DefaultWebsiteRules.DOMESTIC_DIRECT_DOMAINS.size, seeded.websiteRules.size)
        assertEquals(DefaultWebsiteRules.SEED_VERSION, seeded.settings.domesticRulesVersion)

        // Removing a rule stays removed on subsequent seedIfNeeded calls
        val trimmed = seeded.copy(websiteRules = seeded.websiteRules.drop(1))
        val reseeded = DefaultWebsiteRules.seedIfNeeded(trimmed)
        assertEquals(trimmed.websiteRules.size, reseeded.websiteRules.size)

        // Domain normalization
        assertEquals("example.com", DefaultWebsiteRules.normalizeDomain("https://Example.COM/path?q=1"))
        assertEquals("sub.example.org", DefaultWebsiteRules.normalizeDomain("*.sub.example.org."))
        assertTrue(runCatching { DefaultWebsiteRules.normalizeDomain("192.168.1.1") }.isFailure)
        assertTrue(runCatching { DefaultWebsiteRules.normalizeDomain("https://user:pass@example.com") }.isFailure)
    }

    @Test
    fun buildsWebsiteRoutingAndDnsRulesWithSpecificityOrdering() {
        val rules = listOf(
            WebsiteRule("r1", "example.com", "direct", true),
            WebsiteRule("r2", "api.example.com", "proxy", true),
            WebsiteRule("r3", "ads.example.com", "reject", true),
            WebsiteRule("r4", "disabled.example.com", "direct", false),
        )
        val data = AppData(
            nodes = listOf(sampleNode),
            websiteRules = rules,
            settings = Settings(selectedNodeId = "n1", outboundMode = "rule", ipv6Enabled = false),
        )
        val config = JSONObject(ConfigBuilder.build(data, sampleNode))
        val routeRules = config.getJSONObject("route").getJSONArray("rules")

        val domainRules = mutableListOf<Pair<String, String>>()
        for (i in 0 until routeRules.length()) {
            val item = routeRules.getJSONObject(i)
            val suffixes = item.optJSONArray("domain_suffix") ?: continue
            val domain = suffixes.getString(0)
            val action = if (item.optString("action") == "reject") "reject" else item.optString("outbound")
            domainRules += domain to action
        }

        // More specific subdomains must precede parent domain
        assertEquals(listOf("ads.example.com" to "reject", "api.example.com" to "proxy", "example.com" to "direct"), domainRules)

        // Direct domains sync to bootstrap DNS rule
        val dnsRules = config.getJSONObject("dns").getJSONArray("rules")
        assertEquals(2, dnsRules.length())
        assertEquals("example.com", dnsRules.getJSONObject(1).getJSONArray("domain_suffix").getString(0))

        // IPv6 disabled => single IPv4 TUN address and ipv4_only DNS strategy
        assertEquals(1, config.getJSONArray("inbounds").getJSONObject(0).getJSONArray("address").length())
        assertEquals("ipv4_only", config.getJSONObject("dns").getString("strategy"))
    }

    @Test
    fun roundTripsAppDataV2WithUsageWebsiteRulesAndPerAppConfig() {
        val original = AppData(
            nodes = listOf(sampleNode.copy(rawLink = "vless://test")),
            subscriptions = listOf(
                Subscription(
                    id = "s1",
                    url = "https://sub.example.com/list",
                    name = "主订阅",
                    count = 1,
                    updatedAt = 1700000000000L,
                    usage = SubscriptionUsage(100L, 200L, 1000L, 1800000000L),
                )
            ),
            websiteRules = listOf(WebsiteRule("w1", "baidu.com", "direct", true)),
            settings = Settings(
                selectedNodeId = "n1",
                outboundMode = "rule",
                defaultAction = "proxy",
                bypassLan = true,
                allowInsecureNodes = false,
                ipv6Enabled = true,
                perAppMode = "bypass",
                perAppPackages = listOf("com.tencent.mm", "com.eg.android.AlipayGphone"),
                domesticRulesVersion = 1,
                themeMode = "dark",
            ),
        )
        val restored = AppData.fromJson(original.toJson())
        assertEquals(1, restored.nodes.size)
        assertEquals("vless://test", restored.nodes[0].rawLink)
        assertEquals(1000L, restored.subscriptions[0].usage?.total)
        assertEquals("baidu.com", restored.websiteRules[0].domain)
        assertEquals("bypass", restored.settings.perAppMode)
        assertEquals(2, restored.settings.perAppPackages.size)
        assertTrue(restored.settings.ipv6Enabled)
        assertEquals("dark", restored.settings.themeMode)
        assertTrue(restored.settings.sortNodesByLatency)
        assertTrue(restored.settings.hideUnavailableNodes)
    }

    @Test
    fun formatsPresentationWithoutEmoji() {
        assertEquals("HK", NodePresentation.regionCode("香港高速 01"))
        assertEquals("JP", NodePresentation.regionCode("Tokyo Edge"))
        assertEquals("SG", NodePresentation.regionCode("狮城优化"))
        assertEquals("GL", NodePresentation.regionCode("Custom Server"))
        assertEquals("01:02:03", NodePresentation.formatDuration(3723))
        assertEquals("good", NodePresentation.latencyTier(80))
        assertEquals("medium", NodePresentation.latencyTier(250))
        assertEquals("slow", NodePresentation.latencyTier(650))
        assertEquals("failed", NodePresentation.latencyTier(null))
        assertEquals("80.0 Mbps", NodePresentation.formatMbps(10_000_000L))
        assertEquals("1.60 Mbps", NodePresentation.formatMbps(200_000L))
        val now = 1_700_000_000_000L
        assertEquals("刚刚", NodePresentation.formatRelativeTime(now - 30_000L, now))
        assertEquals("15 分钟前", NodePresentation.formatRelativeTime(now - 15 * 60_000L, now))
        assertEquals("3 小时前", NodePresentation.formatRelativeTime(now - 3 * 3600_000L, now))
    }

    @Test
    fun computesRealDelayAndJitterStats() {
        val (avg, jitter) = SpeedTester.computeDelayStats(listOf(60, 70, 80))
        assertEquals(70, avg)
        assertEquals(10, jitter)

        val (singleAvg, singleJitter) = SpeedTester.computeDelayStats(listOf(45))
        assertEquals(45, singleAvg)
        assertEquals(0, singleJitter)

        val (emptyAvg, emptyJitter) = SpeedTester.computeDelayStats(emptyList())
        assertNull(emptyAvg)
        assertNull(emptyJitter)
    }

    @Test
    fun buildsAllVectorIconsAndMigratesV1State() {
        val icons = listOf(
            app.supervpn.android.ui.AppIcons.Dashboard,
            app.supervpn.android.ui.AppIcons.DashboardGrid,
            app.supervpn.android.ui.AppIcons.Nodes,
            app.supervpn.android.ui.AppIcons.Subscriptions,
            app.supervpn.android.ui.AppIcons.Routing,
            app.supervpn.android.ui.AppIcons.Settings,
            app.supervpn.android.ui.AppIcons.Tools,
            app.supervpn.android.ui.AppIcons.Power,
            app.supervpn.android.ui.AppIcons.Play,
            app.supervpn.android.ui.AppIcons.Stop,
            app.supervpn.android.ui.AppIcons.Plus,
            app.supervpn.android.ui.AppIcons.Refresh,
            app.supervpn.android.ui.AppIcons.Trash,
            app.supervpn.android.ui.AppIcons.Search,
            app.supervpn.android.ui.AppIcons.Speed,
            app.supervpn.android.ui.AppIcons.Gauge,
            app.supervpn.android.ui.AppIcons.Globe,
            app.supervpn.android.ui.AppIcons.Shield,
            app.supervpn.android.ui.AppIcons.Copy,
            app.supervpn.android.ui.AppIcons.Edit,
            app.supervpn.android.ui.AppIcons.ChevronRight,
            app.supervpn.android.ui.AppIcons.ArrowBack,
            app.supervpn.android.ui.AppIcons.ArrowUp,
            app.supervpn.android.ui.AppIcons.ArrowDown,
            app.supervpn.android.ui.AppIcons.Apps,
            app.supervpn.android.ui.AppIcons.Terminal,
            app.supervpn.android.ui.AppIcons.Check,
            app.supervpn.android.ui.AppIcons.MoreVert,
            app.supervpn.android.ui.AppIcons.Locate,
            app.supervpn.android.ui.AppIcons.Palette,
            app.supervpn.android.ui.AppIcons.FilterList,
            app.supervpn.android.ui.AppIcons.Info,
            app.supervpn.android.ui.AppIcons.Device,
        )
        assertEquals(33, icons.size)

        val v1Json = """
            {
              "version": 1,
              "nodes": [{
                "id": "n1",
                "name": "Legacy",
                "protocol": "VLESS",
                "host": "example.com",
                "port": 443,
                "outbound": {"type":"vless","server":"example.com","server_port":443,"uuid":"11111111-2222-3333-4444-555555555555"},
                "insecureRequested": false
              }],
              "subscriptions": [{
                "id": "s1",
                "url": "https://sub.example.com/list",
                "name": "sub.example.com",
                "count": 1,
                "updatedAt": 1700000000000
              }],
              "settings": {
                "selectedNodeId": "n1",
                "outboundMode": "rule",
                "defaultAction": "proxy",
                "bypassLan": true,
                "allowInsecureNodes": false
              }
            }
        """.trimIndent()
        val migrated = DefaultWebsiteRules.seedIfNeeded(AppData.fromJson(v1Json))
        assertEquals(1, migrated.nodes.size)
        assertEquals(1, migrated.subscriptions.size)
        assertTrue(migrated.websiteRules.isNotEmpty())
        assertEquals("all", migrated.settings.perAppMode)
    }
}
