package app.supervpn.android.data

import org.json.JSONArray
import org.json.JSONObject

data class Node(
    val id: String,
    val name: String,
    val protocol: String,
    val host: String,
    val port: Int,
    val outbound: JSONObject,
    val subscriptionId: String? = null,
    val insecureRequested: Boolean = false,
    val rawLink: String? = null,
)

data class SubscriptionUsage(
    val upload: Long,
    val download: Long,
    val total: Long,
    val expire: Long? = null,
) {
    val used: Long get() = (upload + download).coerceAtLeast(0L)
    val remaining: Long get() = (total - used).coerceAtLeast(0L)
    val percent: Float get() = if (total <= 0L) 0f else (used.toDouble() / total.toDouble() * 100.0).toFloat().coerceIn(0f, 100f)

    fun toJson(): JSONObject = JSONObject().apply {
        put("upload", upload)
        put("download", download)
        put("total", total)
        expire?.let { put("expire", it) }
    }

    companion object {
        fun fromJson(obj: JSONObject?): SubscriptionUsage? {
            if (obj == null) return null
            val upload = obj.optLong("upload", -1L)
            val download = obj.optLong("download", -1L)
            val total = obj.optLong("total", -1L)
            if (upload < 0L || download < 0L || total < 0L) return null
            val expire = if (obj.has("expire") && !obj.isNull("expire")) obj.optLong("expire", 0L).takeIf { it > 0L } else null
            return SubscriptionUsage(upload, download, total, expire)
        }
    }
}

data class Subscription(
    val id: String,
    val url: String,
    val name: String,
    val count: Int,
    val updatedAt: Long,
    val usage: SubscriptionUsage? = null,
)

data class WebsiteRule(
    val id: String,
    val domain: String,
    val action: String, // "proxy" | "direct" | "reject"
    val enabled: Boolean = true,
)

data class Settings(
    val selectedNodeId: String? = null,
    val outboundMode: String = "rule",
    val defaultAction: String = "proxy",
    val bypassLan: Boolean = true,
    val allowInsecureNodes: Boolean = true,
    val ipv6Enabled: Boolean = true,
    val perAppMode: String = "all", // "all" | "bypass" | "only"
    val perAppPackages: List<String> = emptyList(),
    val domesticRulesVersion: Int = 0,
    val themeMode: String = "system", // "system" | "dark" | "light"
    val sortNodesByLatency: Boolean = true,
    val hideUnavailableNodes: Boolean = true,
)

data class AppData(
    val nodes: List<Node> = emptyList(),
    val subscriptions: List<Subscription> = emptyList(),
    val websiteRules: List<WebsiteRule> = emptyList(),
    val settings: Settings = Settings(),
) {
    fun toJson(): String {
        val root = JSONObject()
        root.put("version", 2)
        root.put("nodes", JSONArray().apply {
            nodes.forEach { node ->
                put(JSONObject().apply {
                    put("id", node.id)
                    put("name", node.name)
                    put("protocol", node.protocol)
                    put("host", node.host)
                    put("port", node.port)
                    put("outbound", node.outbound)
                    node.subscriptionId?.let { put("subscriptionId", it) }
                    put("insecureRequested", node.insecureRequested)
                    node.rawLink?.let { put("rawLink", it) }
                })
            }
        })
        root.put("subscriptions", JSONArray().apply {
            subscriptions.forEach { sub ->
                put(JSONObject().apply {
                    put("id", sub.id)
                    put("url", sub.url)
                    put("name", sub.name)
                    put("count", sub.count)
                    put("updatedAt", sub.updatedAt)
                    sub.usage?.let { put("usage", it.toJson()) }
                })
            }
        })
        root.put("websiteRules", JSONArray().apply {
            websiteRules.forEach { rule ->
                put(JSONObject().apply {
                    put("id", rule.id)
                    put("domain", rule.domain)
                    put("action", rule.action)
                    put("enabled", rule.enabled)
                })
            }
        })
        root.put("settings", JSONObject().apply {
            settings.selectedNodeId?.let { put("selectedNodeId", it) }
            put("outboundMode", settings.outboundMode)
            put("defaultAction", settings.defaultAction)
            put("bypassLan", settings.bypassLan)
            put("honorImportedInsecure", settings.allowInsecureNodes)
            put("dualStackTun", settings.ipv6Enabled)
            put("perAppMode", settings.perAppMode)
            put("perAppPackages", JSONArray().apply {
                settings.perAppPackages.forEach { put(it) }
            })
            put("domesticRulesVersion", settings.domesticRulesVersion)
            put("themeMode", settings.themeMode)
            put("sortNodesByLatency", settings.sortNodesByLatency)
            put("hideUnavailableNodes", settings.hideUnavailableNodes)
        })
        return root.toString()
    }

    companion object {
        fun fromJson(text: String): AppData {
            val root = JSONObject(text)
            val nodes = mutableListOf<Node>()
            root.optJSONArray("nodes")?.let { array ->
                for (i in 0 until array.length()) {
                    val item = array.getJSONObject(i)
                    nodes += Node(
                        id = item.getString("id"),
                        name = item.getString("name"),
                        protocol = item.getString("protocol"),
                        host = item.getString("host"),
                        port = item.getInt("port"),
                        outbound = item.getJSONObject("outbound"),
                        subscriptionId = item.optString("subscriptionId").takeIf { it.isNotEmpty() },
                        insecureRequested = item.optBoolean("insecureRequested", false),
                        rawLink = item.optString("rawLink").takeIf { it.isNotEmpty() },
                    )
                }
            }
            val subscriptions = mutableListOf<Subscription>()
            root.optJSONArray("subscriptions")?.let { array ->
                for (i in 0 until array.length()) {
                    val item = array.getJSONObject(i)
                    subscriptions += Subscription(
                        id = item.getString("id"),
                        url = item.getString("url"),
                        name = item.getString("name"),
                        count = item.optInt("count", 0),
                        updatedAt = item.optLong("updatedAt", 0L),
                        usage = SubscriptionUsage.fromJson(item.optJSONObject("usage")),
                    )
                }
            }
            val websiteRules = mutableListOf<WebsiteRule>()
            root.optJSONArray("websiteRules")?.let { array ->
                for (i in 0 until array.length()) {
                    val item = array.getJSONObject(i)
                    val domain = item.optString("domain").trim().lowercase()
                    val action = item.optString("action", "direct")
                    if (domain.isNotEmpty() && action in setOf("proxy", "direct", "reject")) {
                        websiteRules += WebsiteRule(
                            id = item.optString("id").ifEmpty { "rule-$i" },
                            domain = domain,
                            action = action,
                            enabled = item.optBoolean("enabled", true),
                        )
                    }
                }
            }
            val settingsJson = root.optJSONObject("settings") ?: JSONObject()
            val perAppPackages = mutableListOf<String>()
            settingsJson.optJSONArray("perAppPackages")?.let { array ->
                for (i in 0 until array.length()) {
                    val pkg = array.optString(i).trim()
                    if (pkg.isNotEmpty()) perAppPackages += pkg
                }
            }
            val perAppMode = settingsJson.optString("perAppMode", "all").takeIf {
                it in setOf("all", "bypass", "only")
            } ?: "all"
            val settings = Settings(
                selectedNodeId = settingsJson.optString("selectedNodeId").takeIf { it.isNotEmpty() },
                outboundMode = settingsJson.optString("outboundMode", "rule").takeIf {
                    it in setOf("rule", "global", "direct")
                } ?: "rule",
                defaultAction = settingsJson.optString("defaultAction", "proxy").takeIf {
                    it in setOf("proxy", "direct")
                } ?: "proxy",
                bypassLan = settingsJson.optBoolean("bypassLan", true),
                allowInsecureNodes = if (settingsJson.has("honorImportedInsecure")) {
                    settingsJson.optBoolean("honorImportedInsecure", true)
                } else {
                    true
                },
                ipv6Enabled = if (settingsJson.has("dualStackTun")) {
                    settingsJson.optBoolean("dualStackTun", true)
                } else {
                    true
                },
                perAppMode = perAppMode,
                perAppPackages = perAppPackages.distinct(),
                domesticRulesVersion = settingsJson.optInt("domesticRulesVersion", 0),
                themeMode = settingsJson.optString("themeMode", "system").takeIf {
                    it in setOf("system", "dark", "light")
                } ?: "system",
                sortNodesByLatency = settingsJson.optBoolean("sortNodesByLatency", true),
                hideUnavailableNodes = settingsJson.optBoolean("hideUnavailableNodes", true),
            )
            return AppData(nodes, subscriptions, websiteRules, settings)
        }
    }
}
